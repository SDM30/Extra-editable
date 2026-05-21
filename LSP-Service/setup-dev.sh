#!/bin/bash
# setup-dev.sh - Instalacion completa single-machine (desarrollo)
# Uso: ./setup-dev.sh [num_instancias]
#
# Construye la imagen lsp-server, crea venv, genera .env y levanta con Docker Compose.
# Redis se inicia automaticamente como contenedor independiente.

set -e

# ─── Configuración ───
DEFAULT_INSTANCES=1
INSTANCES=${1:-$DEFAULT_INSTANCES}

# Validar que sea un número
if ! [[ "$INSTANCES" =~ ^[0-9]+$ ]] || [ "$INSTANCES" -lt 1 ]; then
    echo "❌ Error: El número de instancias debe ser un entero positivo"
    echo "Uso: $0 [num_instancias]"
    echo "Ejemplo: $0 3"
    exit 1
fi

echo "=== Configurando LSP Service en contenedor ==="
echo "    Número de instancias: ${INSTANCES}"

# Determinar comando de Docker Compose
if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
    echo "✓ Docker Compose plugin detectado: $(docker compose version)"
elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
    echo "✓ Docker Compose standalone detectado: $(docker-compose --version)"
else
    echo "❌ Docker Compose no está instalado."
    echo "Instálalo con: sudo apt install docker-compose-plugin"
    exit 1
fi

# 1. Verificar requisitos
echo "[1/7] Verificando requisitos..."
command -v docker >/dev/null 2>&1 || { echo "❌ Docker no está instalado. Instálalo primero."; exit 1; }

# 2. Asegurar permisos de Docker
echo "[2/7] Verificando permisos de Docker..."
if ! docker ps >/dev/null 2>&1; then
    echo "⚠️  No tienes permisos para Docker. Ejecuta:"
    echo "   sudo usermod -aG docker $USER"
    echo "   newgrp docker"
    echo "   Luego cierra sesión y vuelve a entrar"
    exit 1
fi
echo "✓ Permisos de Docker correctos"

# 3. Construir imagen LSP
echo "[3/7] Construyendo imagen lsp-server..."
if [ -d "lsp-container" ]; then
    cd lsp-container
    docker build -t lsp-server:latest .
    cd ..
    echo "✓ Imagen lsp-server construida"
else
    echo "⚠️  Directorio lsp-container no encontrado. Saltando..."
fi

# 4. Crear entorno virtual Python (opcional, para desarrollo local)
echo "[4/7] Configurando entorno Python..."
if [ -d "language-service" ]; then
    cd language-service
    
    # Verificar si existe venv
    if [ ! -d "venv" ]; then
        python3 -m venv venv
        echo "✓ Entorno virtual creado en language-service/venv"
    fi
    
    # Instalar dependencias
    source venv/bin/activate
    if [ -f "require.txt" ]; then
        pip install -r require.txt
        echo "✓ Dependencias Python instaladas"
    else
        echo "⚠️  require.txt no encontrado"
    fi
    deactivate
    cd ..
else
    echo "⚠️  Directorio language-service no encontrado"
fi

# 5. Configurar variables de entorno
echo "[5/7] Configurando variables de entorno..."
if [ ! -f language-service/.env ]; then
    cat > language-service/.env << EOF
PROJECTS_DIR=/home/projects
WS_PUBLIC_HOST=0.0.0.0
CONTAINER_IDLE_TIMEOUT=300000
MAX_CLIENTS_PER_CONTAINER=4
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=0
EOF
    echo "✓ Archivo .env creado"
else
    # Agregar variables de Redis si no existen
    if ! grep -q "REDIS_HOST" language-service/.env; then
        cat >> language-service/.env << EOF
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=0
EOF
        echo "✓ Variables de Redis agregadas al .env"
    else
        echo "✓ Archivo .env ya existe"
    fi
fi

# 6. Limpiar instancias anteriores (opcional)
echo "[6/7] Limpiando instancias anteriores..."
$COMPOSE_CMD down --remove-orphans 2>/dev/null || true
echo "✓ Limpieza completada"

# 7. Construir y levantar contenedores
echo "[7/7] Construyendo y levantando servicios con ${INSTANCES} instancia(s)..."

# Iniciar Redis si no esta corriendo (ya no esta en docker-compose)
if ! docker ps --format '{{.Names}}' | grep -qx 'redis-lsp'; then
    docker rm -f redis-lsp 2>/dev/null || true
    docker run -d --name redis-lsp --restart unless-stopped \
        -p 6379:6379 redis:7-alpine \
        redis-server --save "" --appendonly no --stop-writes-on-bgsave-error no
    echo "✓ Redis iniciado (redis-lsp)"
fi

# Verificar si docker-compose.yml usa 'version' (obsoleto en nuevas versiones)
if grep -q "^version:" docker-compose.yml 2>/dev/null; then
    echo "⚠️  Detectada versión obsoleta en docker-compose.yml"
    echo "   La propiedad 'version' ya no se usa en Docker Compose v2+"
fi

$COMPOSE_CMD build

# Detectar IP del host en docker0 para que los contenedores LSP alcancen Redis
HOST_IP=$(ip addr show docker0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)
[ -z "$HOST_IP" ] && HOST_IP="127.0.0.1"
echo "  docker0 IP: $HOST_IP → REDIS_HOST para contenedores LSP"

HOST_IP=$HOST_IP REDIS_HOST=$HOST_IP WS_PUBLIC_HOST=127.0.0.1 $COMPOSE_CMD up -d --scale language-service=${INSTANCES} --scale agent=1

# ─── Resumen final ───

echo ""
echo "========================================="
echo "   Instalación completada exitosamente   "
echo "========================================="
echo ""
echo "📡 Instancias del API: ${INSTANCES}"
echo ""

# Mostrar puertos asignados
echo "🔌 Puertos asignados:"
docker ps --filter "name=lsp-service-language-service" \
    --format "   {{.Names}}: {{.Ports}}" 2>/dev/null | \
    grep -oP '(lsp-service-language-service-\d+): 0\.0\.0\.0:\K[0-9]+' | \
    while read port; do
        echo "   → http://localhost:${port}"
    done

echo ""
echo "📚 Documentación API: http://localhost:<puerto>/docs"
echo ""
echo "Comandos útiles:"
echo "  $COMPOSE_CMD logs -f              # Ver logs en tiempo real"
echo "  $COMPOSE_CMD ps                   # Ver estado de servicios"
echo "  $COMPOSE_CMD down                 # Detener y eliminar servicios"
echo "  $COMPOSE_CMD up -d --scale language-service=${INSTANCES} --scale agent=1  # Reescalar"
echo ""
echo "  # Ver instancias del API"
echo "  docker ps --filter 'name=language-service'"
echo ""
echo "  # Scripts de prueba"
echo "  ./discover-dev.sh               # Crear contenedores LSP en cada instancia"
echo "  ./cleanup-dev.sh                # Limpiar contenedores LSP"
echo ""
echo "Prueba rapida:"
echo "  ./discover-dev.sh -l python"
echo ""
echo "Redis:"
echo "  docker exec redis-lsp redis-cli PING"
echo "  docker exec redis-lsp redis-cli KEYS '*'"
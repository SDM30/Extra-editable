#!/bin/bash
# deploy-dev.sh — Despliegue rápido single-machine (desarrollo)
# Uso: ./deploy-dev.sh [num_instancias]
#
# Inicia Redis automaticamente si no esta corriendo.
# Lee REDIS_HOST de .env si existe; fallback a IP del puente docker0.

set -e

# ─── Configuracion ───
DEFAULT_INSTANCES=1
INSTANCES=${1:-$DEFAULT_INSTANCES}

# Colores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Validar numero de instancias
if ! [[ "$INSTANCES" =~ ^[0-9]+$ ]] || [ "$INSTANCES" -lt 1 ]; then
    echo "❌ Error: El número de instancias debe ser un entero positivo"
    echo "Uso: $0 [num_instancias]"
    echo "Ejemplos:"
    echo "  $0        # 1 instancia (default)"
    echo "  $0 3      # 3 instancias"
    exit 1
fi

# Determinar comando de Docker Compose
if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
else
    echo "❌ Docker Compose no esta instalado."
    exit 1
fi

# Detectar IP del host en docker0 (para que el contenedor API alcance Redis)
HOST_IP=$(ip addr show docker0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)
[ -z "$HOST_IP" ] && HOST_IP="127.0.0.1"

# Leer REDIS_HOST de .env si existe, fallback a HOST_IP
if [ -f .env ]; then
    source .env
fi
REDIS_HOST="${REDIS_HOST:-$HOST_IP}"
echo "Host IP: $HOST_IP  |  Redis: $REDIS_HOST"

# Iniciar Redis si no esta corriendo (ya no esta en docker-compose)
if ! docker ps --format '{{.Names}}' | grep -qx 'redis-lsp'; then
    docker rm -f redis-lsp 2>/dev/null || true
    docker run -d --name redis-lsp --restart unless-stopped \
        -p 6379:6379 redis:7-alpine \
        redis-server --save "" --appendonly no --stop-writes-on-bgsave-error no
    echo "Redis iniciado (redis-lsp)"
fi

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   DESPLIEGUE LSP SERVICE (DEV)      ║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════╣${NC}"
echo -e "${BLUE}║${NC} Instancias: ${INSTANCES}"
echo -e "${BLUE}║${NC} Modo:       desarrollo (hot-reload)"
echo -e "${BLUE}║${NC} Redis:      ${REDIS_HOST}:6379"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

# Construir y levantar
echo -e "${YELLOW}Construyendo y levantando servicios...${NC}"
HOST_IP=$HOST_IP REDIS_HOST=$REDIS_HOST $COMPOSE_CMD up -d --build --scale language-service=${INSTANCES}

sleep 2

# ─── Mostrar resumen ───
echo ""
echo -e "${GREEN}✅ Despliegue completado${NC}"
echo ""

# Puertos asignados
echo "🔌 Puertos de las instancias:"
docker ps --filter "name=lsp-service-language-service" \
    --format "table {{.Names}}\t{{.Ports}}" 2>/dev/null | \
    head -$((INSTANCES + 1))

echo ""
echo -e "${BLUE}Comandos rapidos:${NC}"
echo "  $COMPOSE_CMD logs -f          # Ver logs"
echo "  $COMPOSE_CMD ps               # Estado de servicios"
echo "  ./discover-dev.sh             # Crear contenedores LSP"
echo "  docker ps --filter 'name=lsp' # Ver todo"
echo "  $COMPOSE_CMD down             # Detener todo"
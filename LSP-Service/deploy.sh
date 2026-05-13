#!/bin/bash
# deploy.sh - Despliegue rápido
# Uso: ./deploy.sh [num_instancias]


# Detectar IP del host en docker0
export HOST_IP=$(ip addr show docker0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)
[ -z "$HOST_IP" ] && HOST_IP="127.0.0.1"

echo "Host IP: $HOST_IP"

# Desplegar con la IP
HOST_IP=$HOST_IP docker compose up -d --build --scale language-service=${1:-1}

set -e

# ─── Configuración ───
DEFAULT_INSTANCES=1
INSTANCES=${1:-$DEFAULT_INSTANCES}

# Colores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Validar número de instancias
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
    echo "❌ Docker Compose no está instalado."
    exit 1
fi

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   DESPLIEGUE LSP SERVICE            ║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════╣${NC}"
echo -e "${BLUE}║${NC} Instancias: ${INSTANCES}"
echo -e "${BLUE}║${NC} Modo:       desarrollo (hot-reload)"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

# Construir y levantar
echo -e "${YELLOW}Construyendo y levantando servicios...${NC}"
$COMPOSE_CMD up -d --build --scale language-service=${INSTANCES}

# Esperar a que Redis esté saludable
echo -e "${YELLOW}Esperando a que Redis esté listo...${NC}"
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
echo -e "${BLUE}Comandos rápidos:${NC}"
echo "  $COMPOSE_CMD logs -f          # Ver logs"
echo "  $COMPOSE_CMD ps               # Estado de servicios"
echo "  ./discover-and-create.sh      # Crear contenedores LSP"
echo "  docker ps --filter 'name=lsp' # Ver todo"
echo "  $COMPOSE_CMD down             # Detener todo"
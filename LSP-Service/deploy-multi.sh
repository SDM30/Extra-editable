#!/bin/bash
# deploy-multi.sh — Despliegue del LSP Service en una máquina del clúster
#
# Uso:
#   cp .env.multi .env      # Primera vez: copiar y editar
#   ./deploy-multi.sh        # Desplegar
#   ./deploy-multi.sh --build  # Reconstruir imagen antes de desplegar
#
# Requisitos:
#   - .env configurado con WS_PUBLIC_HOST, REDIS_HOST, etc.
#   - NFS montado en /home/projects (ejecutar scripts/setup-nfs.sh client <IP> primero)
#   - Redis accesible en REDIS_HOST:REDIS_PORT
#   - Imagen lsp-multiplexor:latest construida (cd lsp-container && docker build -t lsp-multiplexor:latest .)

set -euo pipefail

# Colores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# ─── Validaciones ─────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
    echo -e "${RED}[ERROR]${NC} No se encontró .env. Cópialo desde .env.multi y edítalo:"
    echo "  cp .env.multi .env"
    exit 1
fi

# Cargar variables (sin exportar, solo para mostrar)
source .env

if [ -z "${WS_PUBLIC_HOST:-}" ]; then
    echo -e "${RED}[ERROR]${NC} WS_PUBLIC_HOST no está configurado en .env"
    exit 1
fi

if [ -z "${REDIS_HOST:-}" ]; then
    echo -e "${RED}[ERROR]${NC} REDIS_HOST no está configurado en .env"
    exit 1
fi

# ─── Verificaciones previas ────────────────────────────────────────────────────
echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   DESPLIEGUE LSP SERVICE            ║${NC}"
echo -e "${BLUE}║   MODO: MULTI-MÁQUINA               ║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════╣${NC}"
echo -e "${BLUE}║${NC} Máquina:  ${WS_PUBLIC_HOST}:${PORT:-8135}"
echo -e "${BLUE}║${NC} Redis:    ${REDIS_HOST}:${REDIS_PORT:-6379}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

# Verificar conectividad con Redis
echo -e "${YELLOW}Verificando conectividad con Redis (${REDIS_HOST}:${REDIS_PORT:-6379})...${NC}"
if command -v redis-cli &>/dev/null; then
    if redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT:-6379}" ping &>/dev/null; then
        echo -e "${GREEN}  Redis responde PONG${NC}"
    else
        echo -e "${RED}  ERROR: Redis no responde en ${REDIS_HOST}:${REDIS_PORT:-6379}${NC}"
        echo "  Verifica que Redis esté corriendo y accesible desde esta máquina."
        exit 1
    fi
else
    echo -e "${YELLOW}  redis-cli no instalado, saltando verificación.${NC}"
    echo "  Asegúrate manualmente de que Redis esté accesible en ${REDIS_HOST}:${REDIS_PORT:-6379}"
fi

# Verificar NFS
echo -e "${YELLOW}Verificando montaje NFS en /home/projects...${NC}"
if mountpoint -q /home/projects 2>/dev/null; then
    echo -e "${GREEN}  NFS montado en /home/projects${NC}"
else
    echo -e "${RED}  ERROR: /home/projects no está montado (se necesita NFS compartido)${NC}"
    echo "  Ejecuta: sudo scripts/setup-nfs.sh client <IP_DEL_SERVIDOR_NFS>"
    exit 1
fi

# Verificar imagen Docker
echo -e "${YELLOW}Verificando imagen lsp-multiplexor:latest...${NC}"
if docker image inspect lsp-multiplexor:latest &>/dev/null; then
    echo -e "${GREEN}  Imagen lsp-multiplexor:latest encontrada${NC}"
else
    echo -e "${YELLOW}  Imagen no encontrada. Construyendo...${NC}"
    cd lsp-container
    docker build -t lsp-multiplexor:latest .
    cd ..
    echo -e "${GREEN}  Imagen construida${NC}"
fi

# ─── Determinar comando de Docker Compose ──────────────────────────────────────
if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
else
    echo -e "${RED}ERROR: Docker Compose no está instalado.${NC}"
    exit 1
fi

# ─── Desplegar ─────────────────────────────────────────────────────────────────
BUILD_FLAG=""
if [ "${1:-}" = "--build" ]; then
    BUILD_FLAG="--build"
    echo -e "${YELLOW}Reconstruyendo imagen...${NC}"
fi

echo -e "${YELLOW}Levantando servicio...${NC}"
$COMPOSE_CMD up -d $BUILD_FLAG

sleep 3

# ─── Verificar ─────────────────────────────────────────────────────────────────
echo ""
if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT:-8135}/health" | grep -q "200"; then
    echo -e "${GREEN}Despliegue exitoso${NC}"
    echo ""
    echo "  Health:  http://${WS_PUBLIC_HOST}:${PORT:-8135}/health"
    echo "  API:     http://${WS_PUBLIC_HOST}:${PORT:-8135}/lsp/"
    echo ""
    echo "  Logs:    $COMPOSE_CMD logs -f"
    echo "  Estado:  $COMPOSE_CMD ps"
    echo "  Detener: $COMPOSE_CMD down"
else
    echo -e "${RED}ERROR: El servicio no responde en http://localhost:${PORT:-8135}/health${NC}"
    echo "  Revisa los logs: $COMPOSE_CMD logs"
    exit 1
fi

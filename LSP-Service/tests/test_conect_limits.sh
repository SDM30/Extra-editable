#!/bin/bash
# test_conect_limits.sh - Usa test_clients.py para pruebas

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_SCRIPT="$SCRIPT_DIR/test_clients.py"

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

PORT="${1:-32768}"
MAX_CLIENTS="${2:-4}"

echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     PRUEBA DE LÍMITES LSP - CONEXIONES SIMULTÁNEAS          ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "📍 Puerto: ${GREEN}$PORT${NC}"
echo -e "👥 Clientes: ${GREEN}$MAX_CLIENTS${NC}"
echo ""

# Limpiar al salir
cleanup() {
    echo ""
    echo -e "${YELLOW}🛑 Deteniendo clientes...${NC}"
    pkill -f "test_clients.py -p $PORT" 2>/dev/null || true
    echo -e "${GREEN}✅ Limpieza completada${NC}"
    exit 0
}
trap cleanup EXIT INT TERM

# Lanzar clientes persistentes
echo -e "${YELLOW}🔌 Lanzando $MAX_CLIENTS clientes persistentes...${NC}"
echo ""

python3 "$CLIENT_SCRIPT" -m "$PORT" "$MAX_CLIENTS" &
LAUNCHER_PID=$!

# Esperar inicialización
sleep 5

# Verificar conexiones
echo ""
echo -e "${CYAN}📊 Verificando conexiones...${NC}"

CONTAINER=$(docker ps --filter "publish=$PORT" --format "{{.Names}}" 2>/dev/null | head -1)
if [[ -n "$CONTAINER" ]]; then
    CONN=$(docker exec "$CONTAINER" sh -c "ss -tn state established 2>/dev/null | grep ':3000' | wc -l" 2>/dev/null | xargs)
    echo -e "   Conexiones establecidas: ${GREEN}${CONN:-0}${NC}"
fi

# Probar conexión extra
echo ""
echo -e "${YELLOW}🧪 Probando conexión adicional (debería ser rechazada)...${NC}"
echo ""

python3 "$CLIENT_SCRIPT" -e "$PORT"
EXTRA_RESULT=$?

echo ""
if [[ $EXTRA_RESULT -eq 0 ]]; then
    echo -e "${GREEN}✅ LÍMITE VERIFICADO: Conexión extra RECHAZADA${NC}"
elif [[ $EXTRA_RESULT -eq 1 ]]; then
    echo -e "${RED}❌ LÍMITE FALLIDO: Conexión extra ACEPTADA${NC}"
else
    echo -e "${YELLOW}⚠️  ERROR en la prueba${NC}"
fi

echo ""
echo -e "${CYAN}Presiona Ctrl+C para detener los clientes${NC}"

# Esperar
wait $LAUNCHER_PID
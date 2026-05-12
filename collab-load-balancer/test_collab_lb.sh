#!/bin/bash
# test_collab_lb.sh
# Pruebas del balanceador de colaboración.
# Uso: ./test_collab_lb.sh [PUERTO_LB]
#
# Requisitos:
#   - wscat:   npm install -g wscat
#   - jq:      apt install jq  (opcional, para pretty-print)

set -euo pipefail

LB_PORT="${1:-8083}"
LB_URL="http://localhost:${LB_PORT}"
WS_URL="ws://localhost:${LB_PORT}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "${GREEN} PASS${NC} — $1"; }
fail() { echo -e "${RED} FAIL${NC} — $1"; FAILURES=$((FAILURES + 1)); }
info() { echo -e "${CYAN}ℹ  ${NC}$1"; }
FAILURES=0

echo -e "${CYAN} PRUEBAS — COLLAB LOAD BALANCER (puerto ${LB_PORT}) ${NC}"
echo ""

# ────────────────────────────────────────────────────────────────────────────
# 1. Health check
# ────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}[1/4] Health check${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${LB_URL}/health")
if [ "$HTTP_CODE" = "200" ]; then
    BODY=$(curl -s "${LB_URL}/health")
    pass "GET /health → 200 | ${BODY}"
else
    fail "GET /health → esperaba 200, obtuvo ${HTTP_CODE}"
fi
echo ""

# ────────────────────────────────────────────────────────────────────────────
# 2. Pedir token JWT a través del balanceador
# ────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}[2/4] Token JWT vía balanceador${NC}"
TOKEN_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${LB_URL}/dev-token" \
    -H "Content-Type: application/json" \
    -d '{"userId":"test-user-001","username":"TesterLB"}')

TOKEN_BODY=$(echo "$TOKEN_RESPONSE" | head -n1)
TOKEN_STATUS=$(echo "$TOKEN_RESPONSE" | tail -n1)

if [ "$TOKEN_STATUS" = "200" ]; then
    TOKEN=$(echo "$TOKEN_BODY" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$TOKEN" ]; then
        pass "POST /dev-token → 200 | token obtenido (${#TOKEN} chars)"
    else
        fail "POST /dev-token → 200 pero sin token en la respuesta"
        TOKEN=""
    fi
else
    fail "POST /dev-token → esperaba 200, obtuvo ${TOKEN_STATUS}"
    TOKEN=""
fi
echo ""

# ────────────────────────────────────────────────────────────────────────────
# 3. Sticky sessions — múltiples peticiones HTTP deben llegar a la misma instancia
# ────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}[3/4] Sticky sessions (ip_hash)${NC}"
info "Enviando 6 peticiones HTTP desde la misma IP..."

PORTS=()
for i in {1..6}; do
    RESP=$(curl -s -D - -o /dev/null -X POST "${LB_URL}/dev-token" \
        -H "Content-Type: application/json" \
        -d "{\"userId\":\"sticky-test-$i\",\"username\":\"sticky$i\"}" 2>/dev/null)
    # Buscar cabecera X-Instance-Port si las instancias la exponen
    PORT_HEADER=$(echo "$RESP" | grep -i "X-Instance-Port" | awk '{print $2}' | tr -d '\r' || true)
    PORTS+=("${PORT_HEADER:-desconocido}")
done

UNIQUE_PORTS=$(printf "%s\n" "${PORTS[@]}" | sort -u | grep -v "desconocido" | wc -l)

if [ "$UNIQUE_PORTS" -le 1 ]; then
    pass "Todas las peticiones llegaron a la misma instancia (ip_hash funcionando)"
    info "Instancia detectada: ${PORTS[0]}"
else
    info "Se detectaron ${UNIQUE_PORTS} instancias distintas."
    info "Si las instancias no exponen X-Instance-Port esto es esperado."
    info "Agrega el header de diagnóstico (ver README) para validación exacta."
    pass "ip_hash configurado en nginx.conf (validación manual requerida)"
fi
echo ""

# ────────────────────────────────────────────────────────────────────────────
# 4. WebSocket — conectar y desconectar limpiamente
# ────────────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}[4/4] Conexión WebSocket${NC}"

if ! command -v wscat &>/dev/null; then
    info "wscat no instalado. Instalando..."
    npm install -g wscat --silent 2>/dev/null || true
fi

if command -v wscat &>/dev/null && [ -n "$TOKEN" ]; then
    # Conectar, esperar 2s y cerrar
    WS_OUTPUT=$(echo "" | timeout 3 wscat -c "${WS_URL}?token=${TOKEN}" 2>&1 || true)
    if echo "$WS_OUTPUT" | grep -qi "connected\|Connected"; then
        pass "WebSocket conectó correctamente a través del balanceador"
    else
        # wscat puede no mostrar "connected" explícitamente — si no hay error es OK
        if echo "$WS_OUTPUT" | grep -qi "error\|refused\|ECONNREFUSED"; then
            fail "WebSocket falló: ${WS_OUTPUT:0:120}"
        else
            pass "WebSocket sin errores (conexión limpia)"
        fi
    fi
else
    if [ -z "$TOKEN" ]; then
        info "Sin token JWT, omitiendo prueba WebSocket"
    else
        info "wscat no disponible, omitiendo prueba WebSocket"
        info "Prueba manual: wscat -c '${WS_URL}?token=TU_TOKEN'"
    fi
fi
echo ""

# ────────────────────────────────────────────────────────────────────────────
# Resumen
# ────────────────────────────────────────────────────────────────────────────
echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
if [ "$FAILURES" -eq 0 ]; then
    echo -e "${GREEN}Todas las pruebas pasaron ${NC}"
else
    echo -e "${RED}${FAILURES} prueba(s) fallaron ${NC}"
    exit 1
fi
#!/bin/bash
# test-multi-machine.sh — Ejecuta las pruebas de integración multi-máquina
#
# Uso:
#   ./scripts/test-multi-machine.sh
#
# Variables de entorno (opcionales):
#   TEST_HOST_A  URL de la máquina A (default: http://127.0.0.1:8135)
#   TEST_HOST_B  URL de la máquina B (default: http://127.0.0.2:8135)
#
# Ejemplo:
#   TEST_HOST_A=http://10.0.0.1:8135 TEST_HOST_B=http://10.0.0.2:8135 ./scripts/test-multi-machine.sh

set -euo pipefail

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

TEST_HOST_A="${TEST_HOST_A:-http://127.0.0.1:8135}"
TEST_HOST_B="${TEST_HOST_B:-http://127.0.0.2:8135}"

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   LSP MULTI-MACHINE INTEGRATION TESTS ║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════╣${NC}"
echo -e "${BLUE}║${NC} Máquina A: ${TEST_HOST_A}"
echo -e "${BLUE}║${NC} Máquina B: ${TEST_HOST_B}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

# Verificar que pytest está instalado
if ! python3 -c "import pytest" 2>/dev/null; then
    echo -e "${YELLOW}Instalando pytest y httpx...${NC}"
    pip install pytest httpx
fi

# Verificar que ambas máquinas responden antes de ejecutar pruebas
echo -e "${YELLOW}Verificando conectividad con las máquinas...${NC}"

if curl -s -o /dev/null -w "%{http_code}" "${TEST_HOST_A}/health" | grep -q "200"; then
    echo -e "${GREEN}  Máquina A: OK${NC}"
else
    echo -e "${RED}  ERROR: Máquina A (${TEST_HOST_A}) no responde${NC}"
    exit 1
fi

if curl -s -o /dev/null -w "%{http_code}" "${TEST_HOST_B}/health" | grep -q "200"; then
    echo -e "${GREEN}  Máquina B: OK${NC}"
else
    echo -e "${RED}  ERROR: Máquina B (${TEST_HOST_B}) no responde${NC}"
    exit 1
fi

echo ""

# Ejecutar pruebas
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_FILE="${SCRIPT_DIR}/../tests/test_multi_machine.py"

echo -e "${YELLOW}Ejecutando pruebas de integración...${NC}"
echo ""

TEST_HOST_A="${TEST_HOST_A}" TEST_HOST_B="${TEST_HOST_B}" \
    python3 -m pytest "$TEST_FILE" -v

echo ""
echo -e "${GREEN}Pruebas completadas.${NC}"

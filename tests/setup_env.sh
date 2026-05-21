#!/usr/bin/env bash
# setup_env.sh — Exporta todas las variables necesarias para los scripts de prueba.
# Uso: source tests/setup_env.sh
#      (desde la carpeta donde están los scripts: source setup_env.sh)

# ── IPs ─────────────────────────────────────────────────────────────────────────
export DAVID_IP="10.43.98.3"
export MELISSA_IP="10.43.100.126"
export GABRIEL_IP="10.43.100.88"
export SIMON_IP="10.43.99.67"
export CAMPOS_IP="10.43.99.20"

# ── URLs de servicios ────────────────────────────────────────────────────────────
export BACKEND_URL="http://10.43.98.3:8000"
export FRONTEND_URL="http://10.43.98.3:4200"
export LSP_LB_URL="http://10.43.99.20:8085"
export COLLAB_LB_URL="http://10.43.98.3:8083"
export GATEWAY_URL="http://10.43.98.3:8080"

# ── Credenciales SSH por VM ──────────────────────────────────────────────────────
export SSH_USER="estudiante"
export DAVID_SSH_PASS="arquiDavid911"
export MELISSA_SSH_PASS="Pulp0/373l3f"
export GABRIEL_SSH_PASS="Gorila/32Ard"
export SIMON_SSH_PASS="F0c4-16M4p4c"
export CAMPOS_SSH_PASS="C4m4l30n+26C"

# ── Credenciales del usuario de prueba (se registra automáticamente) ─────────────
# Los scripts crean este usuario via POST /api/auth/register/ si no existe.
export API_USER="probe_test"
export API_PASS="ProbeTest123!"
export API_EMAIL="probe_test@test.local"
export API_NOMBRE="Probe Test"

echo "✓ Variables de entorno cargadas."
echo "  Backend  : $BACKEND_URL"
echo "  LSP LB   : $LSP_LB_URL"
echo "  Collab LB: $COLLAB_LB_URL"
echo "  API user : $API_USER"
echo ""
echo "Verificando conectividad y credenciales..."

# 1. Intentar login directo
echo -n "  Backend login ... "
HTTP_CODE=$(curl -s -o /tmp/_jwt_check.json -w "%{http_code}" \
    -X POST "$BACKEND_URL/api/auth/login/" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$API_USER\",\"password\":\"$API_PASS\"}" \
    --max-time 8 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    echo "OK ✓"
else
    echo "usuario no existe (HTTP $HTTP_CODE) — registrando..."

    # 2. Registrar usuario de prueba
    echo -n "  Backend register ... "
    REG_CODE=$(curl -s -o /tmp/_reg_check.json -w "%{http_code}" \
        -X POST "$BACKEND_URL/api/auth/register/" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$API_USER\",\"email\":\"$API_EMAIL\",\"password\":\"$API_PASS\",\"nombre\":\"$API_NOMBRE\"}" \
        --max-time 8 2>/dev/null)

    if [ "$REG_CODE" = "201" ]; then
        echo "OK ✓ (usuario creado)"
    else
        REG_BODY=$(cat /tmp/_reg_check.json 2>/dev/null)
        if echo "$REG_BODY" | grep -qi "already\|exists\|unique"; then
            echo "OK ✓ (ya existía)"
        else
            echo "FALLO (HTTP $REG_CODE): $REG_BODY"
            echo ""
            echo "  ⚠ El backend en $BACKEND_URL no está disponible."
            echo "  Verifica que el servicio esté corriendo en David (10.43.98.3)."
        fi
    fi

    # 3. Login tras registro
    echo -n "  Login tras registro ... "
    HTTP_CODE=$(curl -s -o /tmp/_jwt_check.json -w "%{http_code}" \
        -X POST "$BACKEND_URL/api/auth/login/" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$API_USER\",\"password\":\"$API_PASS\"}" \
        --max-time 8 2>/dev/null)

    if [ "$HTTP_CODE" = "200" ]; then
        echo "OK ✓"
    else
        echo "FALLO (HTTP $HTTP_CODE)"
        echo "  ⚠ No se pudo autenticar. Revisa que el backend esté activo."
    fi
fi

if [ "$HTTP_CODE" = "200" ]; then
    TOKEN=$(python3 -c "import json; d=json.load(open('/tmp/_jwt_check.json')); print(d.get('access','')[:40]+'...')" 2>/dev/null)
    echo "  JWT: $TOKEN"
fi

# Verificar sshpass
echo -n "  sshpass instalado ... "
if command -v sshpass &>/dev/null; then
    echo "OK ✓"
else
    echo "NO instalado"
    echo "  ⚠ Instalar con: sudo apt install sshpass"
fi

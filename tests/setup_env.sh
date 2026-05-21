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

# ── Credenciales de la app Django (usuario seeded) ───────────────────────────────
export API_USER="samuel"
export API_PASS="User1234!"

echo "✓ Variables de entorno cargadas."
echo "  Backend  : $BACKEND_URL"
echo "  LSP LB   : $LSP_LB_URL"
echo "  Collab LB: $COLLAB_LB_URL"
echo "  API user : $API_USER"
echo ""
echo "Verificando conectividad y credenciales..."

# Verificar que el backend responde
echo -n "  Backend login ... "
HTTP_CODE=$(curl -s -o /tmp/_jwt_check.json -w "%{http_code}" \
    -X POST "$BACKEND_URL/api/auth/login/" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$API_USER\",\"password\":\"$API_PASS\"}" \
    --max-time 8 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    echo "OK (HTTP 200) ✓"
    echo "  Token obtenido: $(python3 -c "import json; d=json.load(open('/tmp/_jwt_check.json')); print(d.get('access','')[:30]+'...')" 2>/dev/null)"
else
    echo "FALLO (HTTP $HTTP_CODE)"
    echo ""
    echo "  ⚠ El backend no responde o las credenciales son incorrectas."
    echo "  Prueba manualmente:"
    echo "    curl -X POST $BACKEND_URL/api/auth/login/ \\"
    echo "         -H 'Content-Type: application/json' \\"
    echo "         -d '{\"username\":\"$API_USER\",\"password\":\"$API_PASS\"}'"
    echo ""
    echo "  Si las credenciales son distintas, ajusta API_USER y API_PASS:"
    echo "    export API_USER='tu_usuario'"
    echo "    export API_PASS='tu_password'"
fi

# Verificar sshpass
echo -n "  sshpass instalado ... "
if command -v sshpass &>/dev/null; then
    echo "OK ✓"
else
    echo "NO instalado"
    echo "  ⚠ Instalar con: sudo apt install sshpass"
fi

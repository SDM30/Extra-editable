#!/bin/bash
# start-api-gateway.sh
# Soporta:
#   - Local: todo en misma máquina (--local)
#   - Remoto: Máquina A (APIs) y Máquina B (Gateway) separadas

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_CONF="$SCRIPT_DIR/nginx.conf"
BACKUP_CONF="$SCRIPT_DIR/nginx.conf.bak"

# ─── Modo ───
MODE="${1:-local}"  # local | remote

if [ "$MODE" = "remote" ]; then
    # Máquinas separadas: pedir IP de Máquina A
    if [ -n "$2" ]; then
        LSP_HOST="$2"
    else
        read -p "IP de la Máquina A (LSP Services): " LSP_HOST
    fi
else
    # Local: detectar docker0
    LSP_HOST=$(ip addr show docker0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)
    if [ -z "$LSP_HOST" ]; then
        echo "❌ No se pudo detectar docker0. ¿Docker está corriendo?"
        echo "   Usá: $0 remote <ip-maquina-a>"
        exit 1
    fi
fi

echo "╔══════════════════════════════════════════╗"
echo "║   API GATEWAY                           ║"
echo "╠══════════════════════════════════════════╣"
echo "║ Modo:     $MODE"
echo "║ LSP Host: $LSP_HOST:8085"
echo "╚══════════════════════════════════════════╝"

# ─── Actualizar nginx.conf ───
if [ ! -f "$BACKUP_CONF" ]; then
    cp "$NGINX_CONF" "$BACKUP_CONF"
fi

cp "$BACKUP_CONF" "$NGINX_CONF"

# Reemplazar marcador o IP anterior
if grep -q "{{LSP_BALANCER}}" "$NGINX_CONF"; then
    sed -i "s|{{LSP_BALANCER}}|${LSP_HOST}:8085|g" "$NGINX_CONF"
else
    sed -i "s|proxy_pass http://[^:]*:8085|proxy_pass http://${LSP_HOST}:8085|g" "$NGINX_CONF"
fi

# ─── Levantar ───
docker rm -f api-gateway 2>/dev/null || true

docker run -d --name api-gateway \
  -p 8080:8080 \
  --add-host host.docker.internal:host-gateway \
  -v "$NGINX_CONF:/etc/nginx/nginx.conf:ro" \
  nginx

sleep 1

if curl -s http://localhost:8080/lsp/ >/dev/null 2>&1; then
    echo "✅ API Gateway: http://localhost:8080 → ${LSP_HOST}:8085"
else
    echo "⚠️  Verificar: docker logs api-gateway"
fi
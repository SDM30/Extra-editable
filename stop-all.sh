#!/usr/bin/env bash
# Detiene todos los servicios levantados por start-all.sh
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=== Deteniendo procesos del host ==="
# Matar procesos Python/Node
sudo pkill -f "manage.py runserver" 2>/dev/null || true
sudo pkill -f "node src/server.js" 2>/dev/null || true
sudo pkill -f "ng serve" 2>/dev/null || true
sudo pkill -f "Angular CLI" 2>/dev/null || true
# Watcher LSP
sudo pkill -f "update_nginx.py" 2>/dev/null || true
sleep 2
echo "=== Deteniendo contenedores Docker del proyecto ==="
CONTAINERS=(
  extra-editable-gateway
  collab-lb
  lsp-lb
  lsp-service-agent-1
  lsp-service-language-service-1
  lsp-service-language-service-2
  lsp-service-language-service-3
  redis-lsp
  extra-editable-postgres
)
for c in "${CONTAINERS[@]}"; do
  if docker inspect "$c" >/dev/null 2>&1; then
    docker stop "$c" 2>/dev/null || true
    docker rm -f "$c" 2>/dev/null || true
    echo "  $c detenido y eliminado"
  fi
done
# Matar túneles SSH si existen (puertos 8080, 8083, 8050)
sudo pkill -f "ssh -L 8080" 2>/dev/null || true
sudo pkill -f "ssh -L 8083" 2>/dev/null || true
sudo pkill -f "ssh -L 8050" 2>/dev/null || true
echo "=== Servicios detenidos ==="
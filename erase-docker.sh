#!/usr/bin/env bash
# Elimina TODOS los contenedores, imágenes y volúmenes del stack
# Útil para empezar de cero en pruebas
echo "=== Eliminando contenedores del proyecto ==="
CONTAINERS=(
  extra-editable-gateway collab-lb lsp-lb
  lsp-service-agent-1
  lsp-service-language-service-1
  lsp-service-language-service-2
  lsp-service-language-service-3
  redis-lsp extra-editable-postgres
)
for c in "${CONTAINERS[@]}"; do
  docker rm -f "$c" 2>/dev/null && echo "  $c eliminado" || echo "  $c no existe"
done
# Eliminar contenedores LSP dinámicos (lsp-*-cpp, lsp-*-python, etc.)
docker rm -f $(docker ps -aq --filter name="lsp-") 2>/dev/null && echo "  contenedores lsp-* eliminados"
echo ""
echo "=== Eliminando imágenes del proyecto ==="
IMAGES=(
  lsp-service-language-service:latest
  lsp-service-agent:latest
  lsp-multiplexor:latest
  lsp-server:latest
  nginx:alpine
  redis:7-alpine
  postgres:15-alpine
)
for img in "${IMAGES[@]}"; do
  docker rmi "$img" 2>/dev/null && echo "  $img eliminada" || echo "  $img no existe (o está en uso)"
done
echo ""
echo "=== Eliminando redes y volúmenes ==="
docker network rm lsp-service_lsp-network 2>/dev/null && echo "  red lsp-network eliminada"
echo ""
read -p "¿Eliminar volumen de datos PostgreSQL? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  docker volume rm extra-editable-postgres-data 2>/dev/null && echo "  volumen PostgreSQL eliminado"
fi
echo ""
echo "=== Docker limpio para el proyecto ==="
#!/usr/bin/env bash
# Elimina TODOS los contenedores, imágenes y volúmenes del stack.
# Útil para empezar de cero en pruebas.

set -e

echo "=== Eliminando contenedores del proyecto ==="

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
  docker rm -f "$c" 2>/dev/null && echo "  $c eliminado" || echo "  $c no existe"
done

# Eliminar contenedores LSP dinámicos (lsp-*-cpp, lsp-*-python, etc.)
LSP_DYNAMIC=$(docker ps -aq --filter name="lsp-" 2>/dev/null)
if [ -n "$LSP_DYNAMIC" ]; then
  echo "$LSP_DYNAMIC" | xargs docker rm -f 2>/dev/null && echo "  contenedores lsp-* eliminados"
fi

echo ""
echo "=== Eliminando redes del proyecto ==="

NETWORKS=(
  lsp-service_lsp-network
)

for net in "${NETWORKS[@]}"; do
  docker network rm "$net" 2>/dev/null && echo "  red $net eliminada" || echo "  red $net no existe"
done

echo ""
echo "=== Eliminando imágenes del proyecto ==="

IMAGES=(
  lsp-service-language-service:latest
  lsp-service-agent:latest
  lsp-multiplexor:latest
  lsp-server:latest
)

for img in "${IMAGES[@]}"; do
  docker rmi "$img" 2>/dev/null && echo "  $img eliminada" || echo "  $img no existe (o en uso)"
done

echo ""
echo "=== Eliminando volúmenes del proyecto ==="

read -p "¿Eliminar volumen de datos PostgreSQL? (y/N) " -r
if [[ $REPLY =~ ^[Yy]$ ]]; then
  docker volume rm extra-editable-postgres-data 2>/dev/null && echo "  volumen PostgreSQL eliminado" || echo "  volumen PostgreSQL no existe"
fi

echo ""
echo "=== Docker limpio para el proyecto ==="

#!/bin/bash
# cleanup-containers.sh
# Elimina contenedores LSP por nombre de proyecto
#
# Uso: ./cleanup-containers.sh [nombre_base]
# Ejemplo: ./cleanup-containers.sh test-project

BASE_NAME="${1:-auto-project}"

echo "Buscando contenedores con nombre: ${BASE_NAME}"

CONTAINERS=$(docker ps -q --filter "name=${BASE_NAME}" 2>/dev/null)

if [ -z "$CONTAINERS" ]; then
    echo "No se encontraron contenedores."
    exit 0
fi

echo "Contenedores a eliminar:"
docker ps --filter "name=${BASE_NAME}" --format "  {{.Names}} ({{.ID}})"

echo ""
read -p "¿Confirmar eliminación? [s/N]: " confirm

if [ "$confirm" = "s" ] || [ "$confirm" = "S" ]; then
    docker rm -f $CONTAINERS
    echo "Eliminados."
else
    echo "Cancelado."
fi
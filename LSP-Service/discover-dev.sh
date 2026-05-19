#!/bin/bash
# discover-dev.sh
# Descubre las instancias del API (via docker compose) y crea contenedores LSP en cada una
# 
# Uso: ./discover-dev.sh [opciones]

set -e

LANGUAGE="python"
MAX_CLIENTS=4
BASE_PROJECT_NAME="auto-project"
HOST="localhost"

# Descubrir puertos de las instancias del API
discover_ports() {
    docker ps --filter "name=lsp-service-language-service" \
        --format '{{.Ports}}' | \
        grep -oP '0\.0\.0\.0:\K[0-9]+(?=->8135)' | \
        sort -n
}

# Si no hay docker, usar puertos por defecto
if ! command -v docker &>/dev/null; then
    echo "Docker no disponible. Especifica puertos manualmente."
    echo "Uso: ./create-lsp-dev.sh <puerto1> <puerto2> ..."
    exit 1
fi

# Obtener puertos
PORTS=($(discover_ports))

if [ ${#PORTS[@]} -eq 0 ]; then
    echo "No se encontraron instancias del API corriendo."
    echo "Levanta las instancias primero: docker compose up -d --scale language-service=3"
    exit 1
fi

echo "Instancias descubiertas: ${PORTS[*]}"
echo ""

# Llamar al script principal con los puertos descubiertos
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/create-lsp-dev.sh" \
    -l "$LANGUAGE" \
    -c "$MAX_CLIENTS" \
    -p "$BASE_PROJECT_NAME" \
    "$@" \
    "${PORTS[@]}"
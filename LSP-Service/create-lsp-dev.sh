#!/bin/bash
# create-lsp-containers.sh
# Uso: ./create-lsp-containers.sh [opciones] <puerto1> <puerto2> ...
# 
# Ejemplos:
#   ./create-lsp-containers.sh 32771 32772 32773
#   ./create-lsp-containers.sh -l python -c 4 32771 32772
#   ./create-lsp-containers.sh -p test-project 32771

set -e

# ─── Configuración por defecto ───
LANGUAGE="python"
MAX_CLIENTS=4
BASE_PROJECT_NAME="test-project"
HOST="localhost"
DRY_RUN=false
VERBOSE=false

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ─── Funciones ───

usage() {
    cat << EOF
Uso: $0 [opciones] <puerto1> [puerto2] [puerto3] ...

OPCIONES:
  -l, --language LANG      Lenguaje del LSP (python, cpp, typescript) [default: python]
  -c, --clients NUM        Máximo de clientes por contenedor [default: 4]
  -p, --project NAME       Nombre base del proyecto [default: test-project]
  -h, --host HOST          Host del API [default: localhost]
  -d, --dry-run            Solo mostrar lo que haría, sin ejecutar
  -v, --verbose            Mostrar respuesta completa del API
  --help                   Mostrar esta ayuda

EJEMPLOS:
  $0 32771 32772 32773
  $0 -l cpp -c 2 32771 32772
  $0 -l typescript -p mi-proyecto 32770
  $0 -d 32771 32772          # Dry run (solo simula)
EOF
    exit 0
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Crear contenedor en una instancia específica
create_container() {
    local port=$1
    local project_name=$2
    
    local url="http://${HOST}:${port}/lsp/${project_name}"
    local payload="{\"language\": \"${LANGUAGE}\", \"max_clients\": ${MAX_CLIENTS}}"
    
    if [ "$DRY_RUN" = true ]; then
        echo "  [DRY RUN] POST ${url}"
        echo "  [DRY RUN] Body: ${payload}"
        return 0
    fi
    
    # Hacer la petición
    local response=$(curl -s -w "\n%{http_code}" -X POST "${url}" \
        -H "Content-Type: application/json" \
        -d "${payload}")
    
    # Separar body y status code
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        log_success "Creado en puerto ${port} -> proyecto: ${project_name}"
        
        if [ "$VERBOSE" = true ]; then
            echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
        else
            # Extraer campos clave
            local ws_port=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ws_port','N/A'))" 2>/dev/null)
            local container_id=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('container_id','N/A'))" 2>/dev/null)
            echo "    WS Puerto: ${ws_port}  |  Container ID: ${container_id:0:12}"
        fi
        return 0
    else
        log_error "Fallo en puerto ${port} (HTTP ${http_code})"
        echo "    Respuesta: ${body}" | head -c 200
        return 1
    fi
}

# Verificar si un puerto está accesible
check_port() {
    local port=$1
    curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://${HOST}:${port}/" 2>/dev/null
}

# ─── Parseo de argumentos ───
PORTS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        -l|--language)
            LANGUAGE="$2"
            shift 2
            ;;
        -c|--clients)
            MAX_CLIENTS="$2"
            shift 2
            ;;
        -p|--project)
            BASE_PROJECT_NAME="$2"
            shift 2
            ;;
        -h|--host)
            HOST="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            usage
            ;;
        -*)
            log_error "Opción desconocida: $1"
            usage
            ;;
        *)
            PORTS+=("$1")
            shift
            ;;
    esac
done

# ─── Validaciones ───

if [ ${#PORTS[@]} -eq 0 ]; then
    log_error "Debes especificar al menos un puerto"
    echo ""
    usage
fi

# Validar que los puertos son números
for port in "${PORTS[@]}"; do
    if ! [[ "$port" =~ ^[0-9]+$ ]]; then
        log_error "'${port}' no es un puerto válido"
        exit 1
    fi
done

# Validar lenguaje
case "$LANGUAGE" in
    python|cpp|typescript) ;;
    *)
        log_error "Lenguaje no soportado: ${LANGUAGE}"
        echo "  Usa: python, cpp, typescript"
        exit 1
        ;;
esac

# ─── Mostrar configuración ───

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   CREACIÓN DE CONTENEDORES LSP              ║"
echo "╠══════════════════════════════════════════════╣"
echo "║ Lenguaje:     ${LANGUAGE}"
echo "║ Max clientes: ${MAX_CLIENTS}"
echo "║ Proyecto:     ${BASE_PROJECT_NAME}-<n>"
echo "║ Host:         ${HOST}"
echo "║ Puertos:      ${PORTS[*]}"
echo "║ Instancias:   ${#PORTS[@]}"
if [ "$DRY_RUN" = true ]; then
    echo "║ MODO:         DRY RUN (simulación)"
fi
echo "╚══════════════════════════════════════════════╝"
echo ""

# ─── Verificar conectividad ───

if [ "$DRY_RUN" = false ]; then
    log_info "Verificando conectividad..."
    
    PORTS_REACHABLE=()
    PORTS_UNREACHABLE=()
    
    for port in "${PORTS[@]}"; do
        status=$(check_port "$port")
        if [ "$status" != "000" ] && [ -n "$status" ]; then
            log_success "Puerto ${port} accesible (HTTP ${status})"
            PORTS_REACHABLE+=("$port")
        else
            log_warning "Puerto ${port} NO accesible - se omitirá"
            PORTS_UNREACHABLE+=("$port")
        fi
    done
    
    if [ ${#PORTS_REACHABLE[@]} -eq 0 ]; then
        log_error "Ningún puerto accesible. Abortando."
        exit 1
    fi
    
    PORTS=("${PORTS_REACHABLE[@]}")
    echo ""
fi

# ─── Crear contenedores ───

log_info "Creando contenedores..."
echo ""

SUCCESS=0
FAIL=0
RESULTS=()

for i in "${!PORTS[@]}"; do
    port="${PORTS[$i]}"
    
    # Nombre del proyecto: base-<índice> o base si solo hay uno
    if [ ${#PORTS[@]} -gt 1 ]; then
        project_name="${BASE_PROJECT_NAME}-$((i + 1))"
    else
        project_name="${BASE_PROJECT_NAME}"
    fi
    
    echo "──────────────────────────────────────────────"
    echo "Instancia: ${HOST}:${port}  |  Proyecto: ${project_name}"
    echo "──────────────────────────────────────────────"
    
    if create_container "$port" "$project_name"; then
        SUCCESS=$((SUCCESS + 1))
        RESULTS+=("${project_name}:${port}")
    else
        FAIL=$((FAIL + 1))
    fi
    echo ""
done

# ─── Resumen final ───

echo "══════════════════════════════════════════════"
echo -e "  RESULTADO: ${GREEN}${SUCCESS} éxitos${NC}, ${RED}${FAIL} fallos${NC}"
echo "══════════════════════════════════════════════"
echo ""

if [ ${#RESULTS[@]} -gt 0 ]; then
    echo "Contenedores creados:"
    for result in "${RESULTS[@]}"; do
        echo "  → ${result}"
    done
    echo ""
    echo "Para verificar:"
    echo "  docker ps --filter 'name=${BASE_PROJECT_NAME}'"
    echo ""
fi

# ─── Sugerencias ───

echo "Comandos útiles:"
echo "  # Listar contenedores LSP"
echo "  docker ps --filter 'name=${BASE_PROJECT_NAME}'"
echo ""
echo "  # Ver logs de un contenedor"
echo "  docker logs <container_id>"
echo ""
echo "  # Eliminar todos los contenedores de prueba"
echo "  docker rm -f \$(docker ps -q --filter 'name=${BASE_PROJECT_NAME}')"
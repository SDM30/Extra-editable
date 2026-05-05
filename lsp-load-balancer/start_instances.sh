#!/bin/bash
# start_instances.sh
# Levanta 3 instancias del Servicio de Lenguaje en puertos 8135, 8136 y 8137.
# Cada instancia corre en background y escribe su log en /tmp/lsp-service-<puerto>.log
#
# Uso:
#   ./start_instances.sh          # levantar las 3 instancias
#   ./start_instances.sh stop     # detener las 3 instancias

set -e

PORTS=(8135 8136 8137 8138 8139 8140)
SERVICE_DIR="$(cd "$(dirname "$0")/../LSP-Service/language-service" && pwd)"
VENV_PYTHON="$(cd "$(dirname "$0")/.." && pwd)/.venv_lsp/bin/python3"
LOG_DIR="/tmp"
PID_DIR="/tmp"

# ──────────────────────────────────────────────────────────────────────────────
# Validaciones
# ──────────────────────────────────────────────────────────────────────────────
if [ ! -f "$VENV_PYTHON" ]; then
    echo "ERROR: No se encontró el virtualenv en: $VENV_PYTHON"
    exit 1
fi

if [ ! -f "$SERVICE_DIR/app/main.py" ]; then
    echo "ERROR: No se encontró el servicio en: $SERVICE_DIR"
    exit 1
fi

# ──────────────────────────────────────────────────────────────────────────────
# Funciones
# ──────────────────────────────────────────────────────────────────────────────
start_instance() {
    local port=$1
    local log="$LOG_DIR/lsp-service-$port.log"
    local pid_file="$PID_DIR/lsp-service-$port.pid"

    if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
        echo "  [SKIP] Instancia $port ya está corriendo (PID $(cat "$pid_file"))"
        return
    fi

    PORT=$port "$VENV_PYTHON" -m uvicorn app.main:app \
        --host 0.0.0.0 \
        --port "$port" \
        > "$log" 2>&1 &

    echo $! > "$pid_file"
    echo "  [OK]   Instancia levantada en puerto $port (PID $!) — log: $log"
}

stop_instance() {
    local port=$1
    local pid_file="$PID_DIR/lsp-service-$port.pid"

    if [ ! -f "$pid_file" ]; then
        echo "  [SKIP] No se encontró PID para puerto $port"
        return
    fi

    local pid
    pid=$(cat "$pid_file")

    if kill -0 "$pid" 2>/dev/null; then
        kill "$pid"
        rm -f "$pid_file"
        echo "  [OK]   Instancia $port detenida (PID $pid)"
    else
        echo "  [SKIP] Instancia $port no estaba corriendo (PID $pid ya no existe)"
        rm -f "$pid_file"
    fi
}

status_instance() {
    local port=$1
    local pid_file="$PID_DIR/lsp-service-$port.pid"

    if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
        echo "  [UP]   Puerto $port — PID $(cat "$pid_file")"
    else
        echo "  [DOWN] Puerto $port"
    fi
}

# ──────────────────────────────────────────────────────────────────────────────
# Comandos
# ──────────────────────────────────────────────────────────────────────────────
case "${1:-start}" in
    start)
        echo "Levantando instancias del Servicio de Lenguaje..."
        cd "$SERVICE_DIR"
        for port in "${PORTS[@]}"; do
            start_instance "$port"
        done
        echo ""
        echo "Logs disponibles en:"
        for port in "${PORTS[@]}"; do
            echo "  tail -f $LOG_DIR/lsp-service-$port.log"
        done
        ;;
    stop)
        echo "Deteniendo instancias del Servicio de Lenguaje..."
        for port in "${PORTS[@]}"; do
            stop_instance "$port"
        done
        ;;
    restart)
        echo "Reiniciando instancias del Servicio de Lenguaje..."
        for port in "${PORTS[@]}"; do
            stop_instance "$port"
        done
        sleep 1
        cd "$SERVICE_DIR"
        for port in "${PORTS[@]}"; do
            start_instance "$port"
        done
        ;;
    status)
        echo "Estado de las instancias:"
        for port in "${PORTS[@]}"; do
            status_instance "$port"
        done
        ;;
    logs)
        echo "Mostrando logs (Ctrl+C para salir)..."
        tail -f "$LOG_DIR"/lsp-service-*.log
        ;;
    *)
        echo "Uso: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
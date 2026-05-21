#!/usr/bin/env bash
# recovery-watchdog.sh — Watchdog de auto-recovery para el servicio LSP.
# Referencia de despliegue: rama ansible (VMs universitarias).
#
# Propósito:
#   Monitorea la salud de los nodos LSP (Gabriel y Simon) y los reinicia
#   automáticamente vía SSH cuando detecta que ambos están caídos.
#   Complementa la resiliencia de test_resilience.py (escenario R1).
#
# Topología:
#   gabriel  10.43.100.88   — LSP primario  (Docker Compose en /opt/extra-editable/LSP-Service)
#   simon    10.43.99.67    — LSP réplica   (Docker Compose en /opt/extra-editable/LSP-Service)
#   campos   10.43.99.20:8085 — LSP LB (nginx least_conn)
#
# Configuración (variables de entorno):
#   GABRIEL_IP        10.43.100.88
#   SIMON_IP          10.43.99.67
#   LSP_LB_URL        http://10.43.99.20:8085
#   SSH_USER          estudiante
#   SSH_PASS          (opcional; requiere sshpass instalado)
#   PROJECT_DIR       /opt/extra-editable
#   CHECK_INTERVAL    10      Segundos entre sondeos
#   RECOVERY_WAIT     15      Segundos a esperar tras reiniciar antes de verificar
#   LOG_FILE          /tmp/recovery-watchdog.log
#
# Uso:
#   bash tests/recovery-watchdog.sh
#   bash tests/recovery-watchdog.sh &    # En background
#   GABRIEL_IP=10.43.100.88 SIMON_IP=10.43.99.67 bash tests/recovery-watchdog.sh
#
# Para detener:
#   kill $(cat /tmp/recovery-watchdog.pid)
#
# Nota: el script asume SSH key o sshpass disponible. Si usas contraseña,
#       exporta SSH_PASS y asegúrate de tener sshpass instalado:
#         sudo apt install sshpass

set -uo pipefail

# ── Configuración ────────────────────────────────────────────────────────────────

GABRIEL_IP="${GABRIEL_IP:-10.43.100.88}"
SIMON_IP="${SIMON_IP:-10.43.99.67}"
LSP_LB_URL="${LSP_LB_URL:-http://10.43.99.20:8085}"
SSH_USER="${SSH_USER:-estudiante}"
SSH_PASS="${SSH_PASS:-}"
PROJECT_DIR="${PROJECT_DIR:-/opt/extra-editable}"
CHECK_INTERVAL="${CHECK_INTERVAL:-10}"
RECOVERY_WAIT="${RECOVERY_WAIT:-15}"
LOG_FILE="${LOG_FILE:-/tmp/recovery-watchdog.log}"
PID_FILE="/tmp/recovery-watchdog.pid"

# ── Helpers ───────────────────────────────────────────────────────────────────────

log() {
    local ts
    ts="$(date '+%Y-%m-%d %H:%M:%S')"
    echo "[$ts] $*" | tee -a "$LOG_FILE"
}

ssh_cmd() {
    local host="$1"
    shift
    local cmd="$*"
    if [ -n "$SSH_PASS" ] && command -v sshpass &>/dev/null; then
        sshpass -p "$SSH_PASS" ssh \
            -o StrictHostKeyChecking=no \
            -o BatchMode=no \
            -o ConnectTimeout=10 \
            "${SSH_USER}@${host}" "$cmd" 2>/dev/null
    else
        ssh \
            -o StrictHostKeyChecking=no \
            -o BatchMode=yes \
            -o ConnectTimeout=10 \
            "${SSH_USER}@${host}" "$cmd" 2>/dev/null
    fi
}

# Verifica si un nodo LSP responde (POST /lsp/watchdog-probe, cleanup inmediato)
# Retorna 0 si está sano, 1 si no.
check_lsp_node_via_http() {
    local ip="$1"
    local url="http://${ip}:8135/lsp/watchdog-probe"
    local http_code
    http_code="$(curl -s -o /dev/null -w '%{http_code}' \
        --max-time 5 --connect-timeout 3 \
        -X POST "$url" \
        -H 'Content-Type: application/json' \
        -d '{"language":"python","max_clients":1}' 2>/dev/null)"
    if [ "$http_code" = "200" ]; then
        # Cleanup best-effort
        curl -s -o /dev/null -X DELETE \
            "http://${ip}:8135/lsp/watchdog-probe?language=python" \
            --max-time 3 2>/dev/null || true
        return 0
    fi
    return 1
}

# Verifica si el proceso del language-service está corriendo en el nodo
check_lsp_process() {
    local ip="$1"
    ssh_cmd "$ip" "docker compose -f ${PROJECT_DIR}/LSP-Service/docker-compose.yml ps --status running 2>/dev/null | grep -q 'language-service'"
}

# Reinicia el servicio LSP en un nodo
restart_lsp_node() {
    local ip="$1"
    local name="$2"
    log "RESTART: Iniciando docker compose start en ${name} (${ip})..."
    if ssh_cmd "$ip" "cd ${PROJECT_DIR}/LSP-Service && docker compose start"; then
        log "RESTART: docker compose start OK en ${name}"
        return 0
    else
        log "RESTART ERROR: falló docker compose start en ${name} (${ip})"
        # Intentar docker compose up -d como fallback
        log "RESTART FALLBACK: intentando docker compose up -d en ${name}..."
        ssh_cmd "$ip" "cd ${PROJECT_DIR}/LSP-Service && docker compose up -d" || true
        return 1
    fi
}

# Verifica el health del LB LSP (endpoint local nginx)
check_lb_health() {
    local http_code
    http_code="$(curl -s -o /dev/null -w '%{http_code}' \
        --max-time 5 --connect-timeout 3 \
        "${LSP_LB_URL}/health" 2>/dev/null)"
    [ "$http_code" = "200" ]
}

# ── Main loop ─────────────────────────────────────────────────────────────────────

log "======================================================"
log "RECOVERY WATCHDOG iniciado"
log "  Gabriel  : ${GABRIEL_IP}"
log "  Simon    : ${SIMON_IP}"
log "  LSP LB   : ${LSP_LB_URL}"
log "  Intervalo: ${CHECK_INTERVAL}s"
log "======================================================"

echo "$$" > "$PID_FILE"
log "PID: $$ (guardado en ${PID_FILE})"

consecutive_failures_gabriel=0
consecutive_failures_simon=0
FAIL_THRESHOLD=2  # Reiniciar tras N fallas consecutivas

while true; do
    ts="$(date '+%H:%M:%S')"

    # ── Verificar Gabriel ───────────────────────────────────────────────────────
    if check_lsp_process "$GABRIEL_IP"; then
        consecutive_failures_gabriel=0
        echo "[$ts] gabriel (${GABRIEL_IP}): OK"
    else
        consecutive_failures_gabriel=$((consecutive_failures_gabriel + 1))
        log "WARN: gabriel (${GABRIEL_IP}) no responde (falla #${consecutive_failures_gabriel})"

        if [ "$consecutive_failures_gabriel" -ge "$FAIL_THRESHOLD" ]; then
            log "ACTION: Gabriel caído ${consecutive_failures_gabriel} veces seguidas. Reiniciando..."
            restart_lsp_node "$GABRIEL_IP" "gabriel"
            consecutive_failures_gabriel=0
            log "ACTION: Esperando ${RECOVERY_WAIT}s para estabilización..."
            sleep "$RECOVERY_WAIT"
        fi
    fi

    # ── Verificar Simon ─────────────────────────────────────────────────────────
    if check_lsp_process "$SIMON_IP"; then
        consecutive_failures_simon=0
        echo "[$ts] simon (${SIMON_IP}): OK"
    else
        consecutive_failures_simon=$((consecutive_failures_simon + 1))
        log "WARN: simon (${SIMON_IP}) no responde (falla #${consecutive_failures_simon})"

        if [ "$consecutive_failures_simon" -ge "$FAIL_THRESHOLD" ]; then
            log "ACTION: Simon caído ${consecutive_failures_simon} veces seguidas. Reiniciando..."
            restart_lsp_node "$SIMON_IP" "simon"
            consecutive_failures_simon=0
            log "ACTION: Esperando ${RECOVERY_WAIT}s para estabilización..."
            sleep "$RECOVERY_WAIT"
        fi
    fi

    # ── Estado del LB ───────────────────────────────────────────────────────────
    if ! check_lb_health; then
        log "WARN: LSP LB health no responde (¿nginx en Campos caído?)"
    fi

    sleep "$CHECK_INTERVAL"
done

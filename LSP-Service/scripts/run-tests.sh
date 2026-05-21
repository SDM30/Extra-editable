#!/usr/bin/env bash
set -euo pipefail

# Script to prepare env, start the LSP service and run WS/REST/lifecycle tests.
# Usage: ./scripts/run-tests.sh [PORT]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The repository root is two levels up from this script (LSP-Service)
ROOT_DIR="$SCRIPT_DIR/../.."
cd "$ROOT_DIR"

VENV=".venv"
if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
fi

# shellcheck source=/dev/null
source "$VENV/bin/activate"

pip install --upgrade pip
# use the language-service requirements file
REQ_FILE="$ROOT_DIR/language-service/require.txt"
if [ ! -f "$REQ_FILE" ]; then
  echo "Requirements file not found: $REQ_FILE" >&2
  exit 1
fi
pip install -r "$REQ_FILE"
# Ensure websocket/uvicorn support
pip install "uvicorn[standard]" websockets || true
# Install pytest for running tests
pip install pytest || true

PROJECTS_DIR=${PROJECTS_DIR:-/tmp/lsp_projects}
PORT=${1:-8135}
export PROJECTS_DIR PORT
LSP_BASE_URL="http://127.0.0.1:$PORT"
export LSP_BASE_URL

LOG="/tmp/lsp-service-$PORT.log"
PIDFILE="/tmp/lsp-service-$PORT.pid"

echo "Starting uvicorn on port $PORT (logs: $LOG)"
# Start uvicorn from the language-service directory so the `app` package is importable
cd "$ROOT_DIR/language-service"
PROJECTS_DIR="$PROJECTS_DIR" PORT="$PORT" nohup "$VENV/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" > "$LOG" 2>&1 &
echo $! > "$PIDFILE"
cd - > /dev/null || true

# Give server a moment to start and show tail of logs
sleep 0.8
echo "--- service log (last 50 lines) ---"
tail -n 50 "$LOG" || true

echo "Running tests against $LSP_BASE_URL"
"$VENV/bin/python" -m pytest -q "$ROOT_DIR/tests/test_lsp_ws.py" "$ROOT_DIR/tests/test_lsp_rest.py" "$ROOT_DIR/tests/test_lsp_lifecycle.py"
RET=$?

if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  echo "Stopping uvicorn (pid $PID)"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" || true
  else
    echo "Process $PID not running"
  fi
  rm -f "$PIDFILE"
else
  echo "No pidfile found; nothing to stop"
fi

exit $RET

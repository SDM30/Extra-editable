#!/usr/bin/env bash
# Simple helper to start the local stack used in development:
# backend, frontend, Postgres, API gateway, and collaboration services.
# Usage: ./start-all.sh [JWT_SECRET]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JWT_SECRET="${1:-jwt-secreto}"

mkdir -p "$ROOT_DIR/logs"

VENV_PY="$ROOT_DIR/backend/.venv/bin/python"
if [ -x "$VENV_PY" ]; then
  PYTHON="$VENV_PY"
else
  PYTHON="python3"
fi

export DB_ENGINE="django.db.backends.postgresql"
export DB_NAME="extra_editable"
export DB_USER="postgres"
export DB_PASSWORD="postgres"
export DB_HOST="localhost"
export DB_PORT="5432"
export JWT_SECRET="$JWT_SECRET"
export COLLAB_JWT_SECRET="$JWT_SECRET"
export ALLOWED_HOSTS="localhost,127.0.0.1,172.17.0.1,host.docker.internal"
export PROJECTS_DIR="$ROOT_DIR/.lsp-projects"
mkdir -p "$PROJECTS_DIR"
# Evita que un DEBUG="release" (u otro valor no booleano) rompa python-decouple.
if [ "${DEBUG:-}" = "release" ]; then
  export DEBUG="False"
fi

# Mata procesos previos para asegurar un arranque limpio
stop_previous() {
  echo "Stopping previous services..."
  sudo pkill -f "manage.py runserver" 2>/dev/null || true
  sudo pkill -f "node src/server.js" 2>/dev/null || true
  sudo pkill -f "ng serve" 2>/dev/null || true
  sudo pkill -f "Angular CLI" 2>/dev/null || true
  sudo pkill -f "health_sidecar.py" 2>/dev/null || true
  sudo pkill -f "ssh -L 8083" 2>/dev/null || true
  sudo pkill -f "ssh -L 8050" 2>/dev/null || true
  sleep 2
  echo "Previous services stopped."
}

stop_previous

ensure_npm_deps() {
  local dir="$1"
  if [ -f "$dir/package-lock.json" ]; then
    (cd "$dir" && npm ci)
  else
    (cd "$dir" && npm install)
  fi
}

start_background_command() {
  local log_file="$1"
  shift
  nohup "$@" > "$log_file" 2>&1 &
}

ensure_python_deps() {
  (cd "$ROOT_DIR/backend" && "$PYTHON" -m pip install -r requirements.txt)
}

resolve_node_cmd() {
  if command -v node.exe >/dev/null 2>&1; then
    echo "node.exe"
  elif command -v node >/dev/null 2>&1; then
    echo "node"
  else
    echo ""
  fi
}

ensure_postgres() {
  docker volume create extra-editable-postgres-data >/dev/null
  if docker inspect -f '{{.State.Running}}' extra-editable-postgres >/dev/null 2>&1; then
    if [ "$(docker inspect -f '{{.State.Running}}' extra-editable-postgres)" != "true" ]; then
      docker start extra-editable-postgres >/dev/null
    fi
  else
    docker run -d --name extra-editable-postgres \
      -e POSTGRES_USER=postgres \
      -e POSTGRES_PASSWORD=postgres \
      -e POSTGRES_DB=extra_editable \
      -p 5432:5432 \
      -v extra-editable-postgres-data:/var/lib/postgresql/data \
      postgres:15-alpine >/dev/null
  fi
}

start_docker_nginx() {
  local name="$1"
  local config_path="$2"
  local port="$3"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" -p "$port:$port" \
    --add-host=host.docker.internal:host-gateway \
    -v "$config_path:/etc/nginx/nginx.conf:ro" \
    nginx:alpine >/dev/null
}

ensure_npm_deps "$ROOT_DIR/frontend"
ensure_npm_deps "$ROOT_DIR/code-execution-service"
ensure_npm_deps "$ROOT_DIR/collab-service"
ensure_python_deps
ensure_postgres

NODE_CMD="$(resolve_node_cmd)"
if [ -z "$NODE_CMD" ]; then
  echo "ERROR: node.js no está disponible en PATH"
  exit 1
fi

wait_for_postgres() {
  local max_attempts=10
  local attempt=1
  while [ $attempt -le $max_attempts ]; do
    if docker exec extra-editable-postgres pg_isready -U postgres 2>/dev/null | grep -q "accepting connections"; then
      echo "PostgreSQL listo"
      return 0
    fi
    if docker logs extra-editable-postgres --tail 5 2>/dev/null | grep -qi "recovery"; then
      echo "PostgreSQL en recovery mode, reiniciando contenedor..."
      docker restart extra-editable-postgres >/dev/null
      sleep 5
    fi
    echo "Esperando PostgreSQL... (intento $attempt/$max_attempts)"
    sleep 3
    attempt=$((attempt + 1))
  done
  echo "WARNING: PostgreSQL podria no estar listo tras $max_attempts intentos"
}

wait_for_postgres

echo "Running Django migrations"
(cd "$ROOT_DIR/backend" && "$PYTHON" manage.py migrate --noinput) \
  &> "$ROOT_DIR/logs/backend-migrate.log"

echo "Seeding initial users"
(cd "$ROOT_DIR/backend" && "$PYTHON" manage.py seed --force) \
  &> "$ROOT_DIR/logs/backend-seed.log"

start_docker_nginx extra-editable-gateway "$ROOT_DIR/nginx.conf" 8080

# Collab watcher: debe correr antes que collab-lb para que los backends ya estén
# escritos en nginx.config cuando nginx arranque.
echo "Starting Collab Load Balancer watcher"
(cd "$ROOT_DIR/collab-load-balancer" && python3 update_nginx.py) \
  &> "$ROOT_DIR/logs/collab-lb-watcher.log" &
start_docker_nginx collab-lb "$ROOT_DIR/collab-load-balancer/nginx.config" 8083
# ── LSP Service + agente sidecar ────────────────────────────────────────────────
LSP_DIR="$ROOT_DIR/LSP-Service"
if [ -f "$LSP_DIR/deploy-dev.sh" ]; then
  echo "Starting LSP Service (3 instances + agent)"
  # Asegurar que los contenedores LSP usen el gateway docker0 para alcanzar Redis en el host
  REDIS_HOST=$(ip addr show docker0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1)
  [ -z "$REDIS_HOST" ] && REDIS_HOST="127.0.0.1"
  export REDIS_HOST
  # En single-machine dev, forzar WS_PUBLIC_HOST=127.0.0.1 para que las URLs WebSocket
  # sean alcanzables desde el navegador en la misma máquina.
  export WS_PUBLIC_HOST=127.0.0.1
  echo "  REDIS_HOST=$REDIS_HOST (docker0)  WS_PUBLIC_HOST=$WS_PUBLIC_HOST"
  if docker image inspect lsp-service-language-service:latest &>/dev/null 2>&1; then
    (cd "$LSP_DIR" && bash deploy-dev.sh 3)
  else
    echo "  Building LSP image first..."
    (cd "$LSP_DIR" && bash setup-dev.sh 3)
  fi
  # Build lsp-multiplexor image (required by lifecycle.create_container)
  if docker image inspect lsp-multiplexor:latest &>/dev/null 2>&1; then
    echo "  LSP multiplexor image already exists"
  else
    echo "  Building lsp-multiplexor image..."
    (cd "$LSP_DIR/lsp-container" && docker build -t lsp-multiplexor:latest -t lsp-server:latest .)
  fi
  # Crear venv del watcher si no existe (requiere el paquete redis)
  if [ ! -f "$ROOT_DIR/lsp-load-balancer/venv/bin/python3" ]; then
    echo "  Creating LSP watcher venv..."
    python3 -m venv "$ROOT_DIR/lsp-load-balancer/venv"
    "$ROOT_DIR/lsp-load-balancer/venv/bin/pip" install redis
  fi
  # Health sidecar: expone estado de instancias LSP desde Redis en puerto 9090.
  # Debe iniciarse antes que lsp-lb para que el proxy_pass de /health ya tenga destino.
  echo "Starting LSP health sidecar"
  (cd "$ROOT_DIR/lsp-load-balancer" && ./venv/bin/python3 health_sidecar.py) \
    &> "$ROOT_DIR/logs/lsp-health-sidecar.log" &
  # LSP LB necesita alcanzar los contenedores LSP en lsp-service_lsp-network
  # Se crea después de deploy-dev.sh para que la red ya exista.
  # La config inicial incluye un server dummy (127.0.0.1:1 down) para que nginx arranque
  # sin backends reales; update_nginx.py lo reemplazará al detectar instancias.
  docker rm -f lsp-lb >/dev/null 2>&1 || true
  docker run -d --name lsp-lb \
    --network lsp-service_lsp-network \
    --add-host=host.docker.internal:host-gateway \
    -p 8085:8085 \
    -v "$ROOT_DIR/lsp-load-balancer/nginx.conf:/etc/nginx/nginx.conf:ro" \
    nginx:alpine >/dev/null
  sleep 1
  if [ "$(docker inspect -f '{{.State.Running}}' lsp-lb 2>/dev/null)" != "true" ]; then
    echo "  ERROR: lsp-lb no arrancó. Últimas líneas del log:"
    docker logs lsp-lb --tail 5 2>&1 || true
  else
    echo "  lsp-lb corriendo en puerto 8085"
  fi
  # Conectar también a la red bridge para que el gateway (extra-editable-gateway) lo alcance
  docker network connect bridge lsp-lb 2>/dev/null || true
  # Verificar que lsp-lb está en lsp-service_lsp-network (puede perderse si compose recreó la red)
  if ! docker inspect lsp-lb --format '{{range .NetworkSettings.Networks}}{{.NetworkID}} {{end}}' 2>/dev/null | grep -q "$(docker network inspect lsp-service_lsp-network --format '{{.ID}}' 2>/dev/null)"; then
    echo "  Reconectando lsp-lb a lsp-service_lsp-network..."
    docker network connect lsp-service_lsp-network lsp-lb 2>/dev/null || echo "  WARNING: no se pudo conectar lsp-lb a lsp-service_lsp-network"
  fi
  echo "Starting LSP Load Balancer watcher"
  (cd "$ROOT_DIR/lsp-load-balancer" && ./venv/bin/python3 update_nginx.py) \
    &> "$ROOT_DIR/logs/lsp-watcher.log" &
else
  echo "LSP-Service not found, skipping"
fi

echo "Starting collab load balancer discovery watcher"
start_background_command "$ROOT_DIR/logs/collab-lb-watcher.log" \
  bash -lc "cd '$ROOT_DIR/collab-load-balancer' && COLLAB_DISCOVERY_HOST=127.0.0.1 COLLAB_UPSTREAM_HOST=host.docker.internal '$PYTHON' update_nginx.py"

echo "Starting backend"
start_background_command "$ROOT_DIR/logs/backend.log" \
  bash -lc "cd '$ROOT_DIR/backend' && '$PYTHON' manage.py runserver 0.0.0.0:8000"

echo "Starting frontend"
start_background_command "$ROOT_DIR/logs/frontend.log" \
  bash -lc "cd '$ROOT_DIR/frontend' && npm start"

echo "Starting code-execution-service"
start_background_command "$ROOT_DIR/logs/code-execution.log" \
  bash -lc "cd '$ROOT_DIR/code-execution-service' && npm run dev"

for port in 1234 1235 1236; do
  echo "Starting collab-service on port $port"
  start_background_command "$ROOT_DIR/logs/collab-$port.log" \
    bash -lc "cd '$ROOT_DIR/collab-service' && PORT=$port JWT_SECRET='$JWT_SECRET' DB_ENGINE=django.db.backends.postgresql DB_NAME=extra_editable DB_USER=postgres DB_PASSWORD=postgres DB_HOST=localhost DB_PORT=5432 $NODE_CMD src/server.js"
done

# Health sidecar: sondea collab :1234-1236/health y expone estado en puerto 9091
echo "Starting collab health sidecar"
python3 -m pip install requests -q 2>/dev/null || true
(cd "$ROOT_DIR/collab-load-balancer" && python3 health_sidecar.py) \
  &> "$ROOT_DIR/logs/collab-health-sidecar.log" &

echo "Started backend, frontend, Postgres, gateway, collab LB, collab instances, LSP service, LSP agent, LSP watcher, LSP health sidecar, and collab health sidecar. Logs: $ROOT_DIR/logs"
echo "Started backend, frontend, Postgres, gateway, collab LB, and collab instances. Logs: $ROOT_DIR/logs"

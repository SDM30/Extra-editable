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

ensure_python_deps() {
  (cd "$ROOT_DIR/backend" && "$PYTHON" -m pip install -r requirements.txt)
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
ensure_npm_deps "$ROOT_DIR/collab-service"
ensure_python_deps
ensure_postgres

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
start_docker_nginx collab-lb "$ROOT_DIR/collab-load-balancer/nginx.config" 8083
start_docker_nginx lsp-lb "$ROOT_DIR/lsp-load-balancer/nginx.conf" 8085

echo "Starting collab load balancer discovery watcher"
(
  cd "$ROOT_DIR/collab-load-balancer" && \
  COLLAB_DISCOVERY_HOST=127.0.0.1 \
  COLLAB_UPSTREAM_HOST=host.docker.internal \
  "$PYTHON" update_nginx.py
) &> "$ROOT_DIR/logs/collab-lb-watcher.log" &

echo "Starting backend"
(cd "$ROOT_DIR/backend" && "$PYTHON" manage.py runserver 0.0.0.0:8000) \
  &> "$ROOT_DIR/logs/backend.log" &

echo "Starting frontend"
(cd "$ROOT_DIR/frontend" && npm start) \
  &> "$ROOT_DIR/logs/frontend.log" &

for port in 1234 1235 1236; do
  echo "Starting collab-service on port $port"
  (
    cd "$ROOT_DIR/collab-service" && \
    PORT=$port JWT_SECRET="$JWT_SECRET" \
    DB_ENGINE=django.db.backends.postgresql \
    DB_NAME=extra_editable \
    DB_USER=postgres \
    DB_PASSWORD=postgres \
    DB_HOST=localhost \
    DB_PORT=5432 \
    node src/server.js
  ) &> "$ROOT_DIR/logs/collab-$port.log" &
done

echo "Started backend, frontend, Postgres, gateway, collab LB, and collab instances. Logs: $ROOT_DIR/logs"

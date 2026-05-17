#!/usr/bin/env bash
# Simple helper to start backend and three collab-service instances in background
# Usage: ./start-all.sh [JWT_SECRET]

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JWT_SECRET="${1:-jwt-secreto}"

mkdir -p "$ROOT_DIR/logs"

echo "Starting backend with JWT_SECRET=$JWT_SECRET"
(cd "$ROOT_DIR/backend" && JWT_SECRET="$JWT_SECRET" python3 manage.py runserver 8000) &> "$ROOT_DIR/logs/backend.log" &

for port in 1234 1235 1236; do
  echo "Starting collab-service on port $port"
  (cd "$ROOT_DIR/collab-service" && PORT=$port JWT_SECRET="$JWT_SECRET" node src/server.js) &> "$ROOT_DIR/logs/collab-$port.log" &
done

echo "Started backend and collab instances. Logs: $ROOT_DIR/logs"

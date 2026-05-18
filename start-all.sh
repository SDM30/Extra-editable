#!/usr/bin/env bash
# Levanta el stack de desarrollo con una ventana/panel por servicio.
# Uso: ./start-all.sh [JWT_SECRET]
#
# Prioridad:
#   1. tmux  (funciona siempre, con o sin entorno gráfico)
#   2. Terminal gráfico detectado automáticamente (gnome-terminal, konsole, etc.)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JWT_SECRET="${1:-jwt-secreto}"

mkdir -p "$ROOT_DIR/logs"

# ── Variables de entorno compartidas ──────────────────────────────────────────
export DB_ENGINE="django.db.backends.postgresql"
export DB_NAME="extra_editable"
export DB_USER="postgres"
export DB_PASSWORD="postgres"
export DB_HOST="localhost"
export DB_PORT="5432"
export JWT_SECRET="$JWT_SECRET"
export COLLAB_JWT_SECRET="$JWT_SECRET"

# ── Fijar DISPLAY si falta (necesario para terminales gráficos) ───────────────
if [ -z "$DISPLAY" ]; then
  export DISPLAY=":0"
fi

# ── Detectar modo de apertura de ventanas ─────────────────────────────────────
detect_launcher() {
  if command -v tmux &>/dev/null; then
    echo "tmux"
    return
  fi
  for term in gnome-terminal konsole xfce4-terminal mate-terminal tilix alacritty xterm; do
    if command -v "$term" &>/dev/null; then
      echo "$term"
      return
    fi
  done
  echo ""
}

LAUNCHER=$(detect_launcher)

if [ -z "$LAUNCHER" ]; then
  echo "❌  No se encontró tmux ni ningún emulador de terminal."
  echo "    Instala tmux:  sudo apt install tmux"
  exit 1
fi

echo "✅  Modo de lanzamiento: $LAUNCHER"

# ── Helpers de preparación ────────────────────────────────────────────────────
ensure_npm_deps() {
  local dir="$1"
  echo "  📦 npm deps → $dir"
  if [ -f "$dir/package-lock.json" ]; then
    (cd "$dir" && npm ci --prefer-offline 2>/dev/null || npm ci)
  else
    (cd "$dir" && npm install)
  fi
}

ensure_python_deps() {
  echo "  🐍 pip deps → backend"
  (cd "$ROOT_DIR/backend" && python3 -m pip install -r requirements.txt -q)
}

ensure_postgres() {
  echo "  🐘 Postgres..."
  docker volume create extra-editable-postgres-data >/dev/null 2>&1
  local running
  running=$(docker inspect -f '{{.State.Running}}' extra-editable-postgres 2>/dev/null)

  if [ "$running" = "true" ]; then
    echo "     ya está corriendo"
  elif [ "$running" = "false" ]; then
    docker start extra-editable-postgres >/dev/null
    echo "     contenedor reiniciado"
  else
    docker run -d --name extra-editable-postgres \
      -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
      -e POSTGRES_DB=extra_editable \
      -p 5432:5432 \
      -v extra-editable-postgres-data:/var/lib/postgresql/data \
      postgres:15-alpine >/dev/null
    echo "     contenedor creado"
  fi

  echo "  ⏳ Esperando a Postgres..."
  until docker exec extra-editable-postgres pg_isready -U postgres -q 2>/dev/null; do
    sleep 1
  done
  echo "  ✅ Postgres listo"
}

start_docker_nginx() {
  local name="$1" config_path="$2" port="$3"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" \
    --network host \
    -v "$config_path:/etc/nginx/nginx.conf:ro" \
    nginx:alpine >/dev/null
  echo "  🌐 $name en :$port"
}

# ── Función unificada para abrir panel/ventana ────────────────────────────────
# open_pane <nombre> <comando>
TMUX_SESSION="extra-editable"

open_pane() {
  local name="$1"
  local cmd="$2"
  local full_cmd="$cmd; echo ''; echo '--- $name terminado. Presiona Enter para cerrar ---'; read"

  case "$LAUNCHER" in

    tmux)
      if ! tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
        # Primera ventana: crear sesión nueva
        tmux new-session -d -s "$TMUX_SESSION" -x 220 -y 50 -n "$name"
        tmux send-keys -t "$TMUX_SESSION" "$full_cmd" Enter
      else
        # Ventanas siguientes: nueva pestaña dentro de la sesión
        tmux new-window -t "$TMUX_SESSION" -n "$name"
        tmux send-keys -t "$TMUX_SESSION:$name" "$full_cmd" Enter
      fi
      ;;

    gnome-terminal)
      DISPLAY="$DISPLAY" gnome-terminal --title="$name" -- bash -c "$full_cmd" &
      sleep 0.4
      ;;
    konsole)
      DISPLAY="$DISPLAY" konsole --new-tab -p tabtitle="$name" -e bash -c "$full_cmd" &
      sleep 0.4
      ;;
    xfce4-terminal)
      DISPLAY="$DISPLAY" xfce4-terminal --title="$name" -x bash -c "$full_cmd" &
      sleep 0.4
      ;;
    mate-terminal)
      DISPLAY="$DISPLAY" mate-terminal --title="$name" -x bash -c "$full_cmd" &
      sleep 0.4
      ;;
    tilix)
      DISPLAY="$DISPLAY" tilix -t "$name" -x bash -c "$full_cmd" &
      sleep 0.4
      ;;
    alacritty)
      DISPLAY="$DISPLAY" alacritty --title "$name" -e bash -c "$full_cmd" &
      sleep 0.4
      ;;
    xterm)
      DISPLAY="$DISPLAY" xterm -title "$name" -e bash -c "$full_cmd" &
      sleep 0.4
      ;;
  esac
}

# ── 1. Dependencias ───────────────────────────────────────────────────────────
echo ""
echo "=== Preparando dependencias ==="
ensure_npm_deps "$ROOT_DIR/frontend"
ensure_npm_deps "$ROOT_DIR/collab-service"
ensure_python_deps
ensure_postgres

# ── 2. Infraestructura Docker ─────────────────────────────────────────────────
echo ""
echo "=== Levantando nginx ==="
start_docker_nginx extra-editable-gateway "$ROOT_DIR/nginx.conf" 8080
start_docker_nginx collab-lb "$ROOT_DIR/collab-load-balancer/nginx.config" 8083

# ── 3. Migraciones ────────────────────────────────────────────────────────────
echo ""
echo "=== Ejecutando migraciones ==="
(cd "$ROOT_DIR/backend" && python3 manage.py migrate --noinput)

# ── 4. Abrir panel/ventana por servicio ───────────────────────────────────────
echo ""
echo "=== Abriendo servicios ==="

open_pane "Backend :8000" \
  "cd '$ROOT_DIR/backend' && DB_ENGINE=django.db.backends.postgresql DB_NAME=extra_editable DB_USER=postgres DB_PASSWORD=postgres DB_HOST=localhost DB_PORT=5432 python3 manage.py runserver 8000"

open_pane "Frontend :4200" \
  "cd '$ROOT_DIR/frontend' && npm start"

for port in 1234 1235 1236; do
  open_pane "Collab :$port" \
    "cd '$ROOT_DIR/collab-service' && PORT=$port JWT_SECRET='$JWT_SECRET' DB_HOST=localhost DB_PORT=5432 DB_NAME=extra_editable DB_USER=postgres DB_PASSWORD=postgres node src/server.js"
done

# ── 5. Resumen y adjuntar tmux ────────────────────────────────────────────────
echo ""
echo "✅  Servicios iniciados:"
echo "   • Backend     → http://localhost:8000"
echo "   • Frontend    → http://localhost:4200"
echo "   • API Gateway → http://localhost:8080"
echo "   • Collab LB   → http://localhost:8083"
echo "   • Collab      → ws://localhost:1234  1235  1236"
echo ""

if [ "$LAUNCHER" = "tmux" ]; then
  echo "   Sesión tmux: '$TMUX_SESSION'"
  echo "   Atajos de teclado:"
  echo "     Adjuntarse       →  tmux attach -t $TMUX_SESSION"
  echo "     Siguiente panel  →  Ctrl+B  luego  n"
  echo "     Panel por número →  Ctrl+B  luego  0-4"
  echo "     Cerrar todo      →  tmux kill-session -t $TMUX_SESSION"
  echo ""

  # Si no estamos ya dentro de tmux, adjuntarse automáticamente
  if [ -z "$TMUX" ]; then
    tmux attach -t "$TMUX_SESSION"
  fi
fi
#!/bin/bash
# install.sh - Instala y configura el balanceador LSP
# Uso: ./install.sh [--force]

set -e

# Colores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

FORCE=false
[[ "$1" == "--force" ]] && FORCE=true

echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   INSTALACIÓN BALANCEADOR LSP           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# ─── 1. Verificar requisitos ───
echo -e "${YELLOW}[1/5] Verificando requisitos...${NC}"

command -v nginx >/dev/null 2>&1 || {
    echo -e "${RED}❌ Nginx no instalado.${NC}"
    echo "   Instalar: sudo apt install nginx"
    exit 1
}
echo -e "${GREEN}✓ Nginx encontrado${NC}"

command -v redis-cli >/dev/null 2>&1 || {
    echo -e "${RED}❌ redis-cli no encontrado.${NC}"
    echo "   Instalar: sudo apt install redis-tools"
    exit 1
}
echo -e "${GREEN}✓ redis-cli encontrado${NC}"

# Buscar Python del venv del proyecto
if [ -f "$PROJECT_DIR/.venv/bin/python3" ]; then
    PYTHON_BIN="$PROJECT_DIR/.venv/bin/python3"
elif [ -f "$HOME/Development/ARQ/Proyecto_ARQ/.venv_lsp/bin/python3" ]; then
    PYTHON_BIN="$HOME/Development/ARQ/Proyecto_ARQ/.venv_lsp/bin/python3"
else
    PYTHON_BIN=$(command -v python3)
fi
echo -e "${GREEN}✓ Python: $PYTHON_BIN${NC}"

# ─── Instalar dependencias Python ───
echo -e "${YELLOW}[*] Verificando dependencias Python...${NC}"

REQUIRED_MODULES="redis"
for module in $REQUIRED_MODULES; do
    if ! $PYTHON_BIN -c "import $module" 2>/dev/null; then
        echo "   Instalando $module..."
        $PYTHON_BIN -m pip install $module
    else
        echo -e "   ${GREEN}✓ $module ya instalado${NC}"
    fi
done

# ─── 2. Verificar Redis ───
echo -e "${YELLOW}[2/5] Verificando conexión a Redis...${NC}"

if redis-cli ping >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Redis responde PONG${NC}"
else
    echo -e "${YELLOW}⚠ Redis no responde en localhost:6379. Iniciando contenedor...${NC}"
    docker rm -f redis-lsp 2>/dev/null || true
    docker run -d --name redis-lsp --restart unless-stopped \
        -p 6379:6379 redis:7-alpine \
        redis-server --save "" --appendonly no --stop-writes-on-bgsave-error no
    sleep 2
    if redis-cli ping >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Redis iniciado y responde PONG${NC}"
    else
        echo -e "${RED}❌ No se pudo iniciar Redis${NC}"
        exit 1
    fi
fi

# ─── 3. Detener instancias previas si se fuerza ───
if [ "$FORCE" = true ]; then
    echo -e "${YELLOW}[*] Forzando reinstalación...${NC}"
    
    # Detener Nginx si corre con nuestra config
    if pgrep -f "nginx.*lsp-load-balancer" >/dev/null; then
        echo "   Deteniendo Nginx balanceador..."
        nginx -c "$SCRIPT_DIR/nginx.conf" -s quit 2>/dev/null || true
        sleep 1
    fi
    
    # Detener watcher previo
    if systemctl is-active --quiet lsp-watcher 2>/dev/null; then
        echo "   Deteniendo watcher..."
        sudo systemctl stop lsp-watcher
    fi
fi

# ─── 4. Instalar servicio systemd para el watcher ───
echo -e "${YELLOW}[3/5] Instalando servicio systemd para el watcher...${NC}"

SERVICE_FILE="/etc/systemd/system/lsp-watcher.service"

cat > /tmp/lsp-watcher.service << EOF
[Unit]
Description=LSP Load Balancer Watcher
After=network.target redis.service
Wants=redis.service

[Service]
Type=simple
User=root
WorkingDirectory=$SCRIPT_DIR
ExecStart=$PYTHON_BIN $SCRIPT_DIR/update_nginx.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Variables de entorno
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=REDIS_HOST=localhost
Environment=REDIS_PORT=6379
Environment=NGINX_TEMPLATE_PATH=$SCRIPT_DIR/nginx_template.conf
Environment=NGINX_CONF_PATH=$SCRIPT_DIR/nginx.conf
Environment=POLL_INTERVAL=1
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

sudo cp /tmp/lsp-watcher.service "$SERVICE_FILE"
rm /tmp/lsp-watcher.service

sudo systemctl daemon-reload
sudo systemctl enable lsp-watcher
echo -e "${GREEN}✓ Servicio lsp-watcher instalado${NC}"

# ─── 5. Levantar Nginx y watcher ───
echo -e "${YELLOW}[4/5] Levantando Nginx balanceador...${NC}"

# Validar configuración
if nginx -t -c "$SCRIPT_DIR/nginx.conf" 2>&1 | grep -q "successful"; then
    echo -e "${GREEN}✓ Configuración Nginx válida${NC}"
else
    echo -e "${RED}❌ Error en nginx.conf${NC}"
    nginx -t -c "$SCRIPT_DIR/nginx.conf"
    exit 1
fi

# Detener instancia previa si existe
nginx -c "$SCRIPT_DIR/nginx.conf" -s quit 2>/dev/null || true
sleep 1

# Levantar Nginx
nginx -c "$SCRIPT_DIR/nginx.conf"
echo -e "${GREEN}✓ Nginx balanceador levantado en puerto 8085${NC}"

echo -e "${YELLOW}[5/5] Iniciando watcher...${NC}"
sudo systemctl start lsp-watcher
sleep 2

# ─── Verificación final ───
echo ""
echo -e "${BLUE}══════════════════════════════════════════${NC}"
echo -e "${BLUE}   VERIFICACIÓN FINAL                     ${NC}"
echo -e "${BLUE}══════════════════════════════════════════${NC}"
echo ""

# Health check
if curl -s http://localhost:8085/health | grep -q "ok"; then
    echo -e "${GREEN}✅ Balanceador: OK${NC}"
    curl -s http://localhost:8085/health
else
    echo -e "${RED}❌ Balanceador no responde${NC}"
fi

# Watcher status
if systemctl is-active --quiet lsp-watcher; then
    echo -e "${GREEN}✅ Watcher: corriendo${NC}"
    echo ""
    echo -e "${BLUE}Últimas líneas del watcher:${NC}"
    sudo journalctl -u lsp-watcher -n 5 --no-pager 2>/dev/null || true
else
    echo -e "${RED}❌ Watcher no está corriendo${NC}"
fi

echo ""
echo -e "${BLUE}Comandos útiles:${NC}"
echo "  sudo systemctl status lsp-watcher   # Estado del watcher"
echo "  sudo systemctl restart lsp-watcher  # Reiniciar watcher"
echo "  sudo journalctl -u lsp-watcher -f   # Logs del watcher"
echo "  sudo systemctl stop lsp-watcher     # Detener watcher"
echo ""
echo -e "${GREEN}✅ Instalación completada${NC}"
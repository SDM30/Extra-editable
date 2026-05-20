#!/usr/bin/env bash
# Script de despliegue único — corre desde el nodo de control (Samuel).
# Descarga el código, instala Ansible si es necesario y orquesta el despliegue
# completo en todas las VMs del proyecto.
#
# Uso:
#   bash deploy.sh
#
# Desde un portátil (solo conexión SSH):
#   ssh estudiante@10.43.99.252 "bash -s" < deploy.sh

set -euo pipefail

REPO_URL="https://github.com/SDM30/Extra-editable.git"
BRANCH="ansible"
DEST="/opt/extra-editable"

echo "=========================================="
echo "  Extra-editable — Despliegue automático"
echo "=========================================="

# ── 1. Instalar Ansible si no está presente ──────────────────────────────────
if ! command -v ansible-playbook &>/dev/null; then
    echo "[1/3] Instalando Ansible..."
    sudo apt-get update -y -qq
    sudo apt-get install -y -qq ansible
else
    echo "[1/3] Ansible ya instalado ($(ansible --version | head -1))"
fi

# ── 2. Clonar o actualizar el repositorio ────────────────────────────────────
echo "[2/3] Sincronizando repositorio en $DEST..."
if [ -d "$DEST/.git" ]; then
    sudo git -C "$DEST" fetch origin
    sudo git -C "$DEST" checkout "$BRANCH"
    sudo git -C "$DEST" reset --hard "origin/$BRANCH"
else
    sudo git clone --branch "$BRANCH" "$REPO_URL" "$DEST"
fi
sudo chown -R "$(whoami):$(whoami)" "$DEST"

# ── 3. Ejecutar el playbook maestro ──────────────────────────────────────────
echo "[3/3] Iniciando despliegue Ansible..."
cd "$DEST/ansible"
ansible-playbook playbooks/site.yml --ask-vault-pass

echo ""
echo "Despliegue completado."
echo "Frontend disponible en: http://10.43.98.3:4200"

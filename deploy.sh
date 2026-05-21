#!/usr/bin/env bash
# Script de despliegue unico -- corre desde el nodo de control (Samuel).
# Descarga el codigo, instala Ansible si es necesario y orquesta el despliegue
# completo en todas las VMs del proyecto.
#
# Uso desde el portatil (Windows PowerShell):
#   scp deploy.sh estudiante@10.43.99.252:~/
#   ssh -t estudiante@10.43.99.252 "bash ~/deploy.sh"

set -euo pipefail

REPO_URL="https://github.com/SDM30/Extra-editable.git"
BRANCH="ansible"
DEST="$HOME/extra-editable"

echo "=========================================="
echo "  Extra-editable - Despliegue automatico"
echo "=========================================="

# -- 1. Instalar Ansible si no esta presente ----------------------------------
if ! command -v ansible-playbook &>/dev/null; then
    echo "[1/3] Instalando Ansible..."
    sudo apt-get update -y -qq
    sudo apt-get install -y -qq ansible
else
    echo "[1/3] Ansible ya instalado ($(ansible --version | head -1))"
fi

# -- 2. Clonar o actualizar el repositorio ------------------------------------
echo "[2/3] Sincronizando repositorio en $DEST..."
if [ -d "$DEST/.git" ]; then
    git -C "$DEST" fetch origin
    git -C "$DEST" checkout "$BRANCH"
    git -C "$DEST" reset --hard "origin/$BRANCH"
else
    git clone --branch "$BRANCH" "$REPO_URL" "$DEST"
fi

# -- 3. Ejecutar el playbook maestro ------------------------------------------
echo "[3/3] Iniciando despliegue Ansible..."
cd "$DEST/ansible"
ansible-playbook playbooks/site.yml --ask-vault-pass

echo ""
echo "Despliegue completado."
echo "Frontend disponible en: http://10.43.98.3:4200"

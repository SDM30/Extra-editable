#!/bin/bash
# setup-nfs.sh — Configuración automatizada de NFS para LSP-Service multi-máquina
#
# Uso:
#   En la máquina que EXPORTA los proyectos (servidor):
#     sudo ./scripts/setup-nfs.sh server
#
#   En cada máquina que CONSUME los proyectos (cliente del API):
#     sudo ./scripts/setup-nfs.sh client <IP_DEL_SERVIDOR>
#
#   Diagnóstico:
#     ./scripts/setup-nfs.sh check
#
# Ejemplo completo (3 máquinas):
#   [servidor]  sudo ./scripts/setup-nfs.sh server
#   [máquina 1] sudo ./scripts/setup-nfs.sh client 10.0.0.3
#   [máquina 2] sudo ./scripts/setup-nfs.sh client 10.0.0.3
#   [cualquiera] ./scripts/setup-nfs.sh check
#
# Idempotente: se puede ejecutar múltiples veces sin efectos colaterales.
# Si el export/fstab/montaje ya existe, se omite o se actualiza sin duplicar.

set -euo pipefail

# ─── Configuración (modificable) ──────────────────────────────────────────────
NFS_EXPORT_DIR="/srv/nfs/projects"       # Directorio a exportar en el servidor
NFS_MOUNT_POINT="/home/projects"         # Punto de montaje en los clientes
# Red autorizada a acceder al export. Se puede sobrescribir con variable de entorno:
#   NFS_ALLOWED_NETWORK=192.168.20.0/24 sudo -E ./scripts/setup-nfs.sh server
NFS_ALLOWED_NETWORK="${NFS_ALLOWED_NETWORK:-10.0.0.0/24}"

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

require_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "Este script debe ejecutarse como root (usa sudo)."
        exit 1
    fi
}

check_os() {
    if ! command -v apt-get &>/dev/null; then
        log_error "Este script solo soporta Debian/Ubuntu. Adapta los comandos para tu distro."
        exit 1
    fi
}

# ─── Servidor ─────────────────────────────────────────────────────────────────
setup_server() {
    local local_ip
    local_ip=$(ip -4 addr show scope global | grep inet | awk '{print $2}' | cut -d/ -f1 | head -1)

    log_info "Configurando servidor NFS en ${local_ip}..."
    require_root
    check_os

    # 1. Instalar paquetes
    log_info "Instalando nfs-kernel-server..."
    apt-get update -qq
    apt-get install -y -qq nfs-kernel-server

    # 2. Crear directorio compartido
    if [ ! -d "$NFS_EXPORT_DIR" ]; then
        mkdir -p "$NFS_EXPORT_DIR"
        log_ok "Directorio creado: $NFS_EXPORT_DIR"
    else
        log_info "Directorio ya existe: $NFS_EXPORT_DIR"
    fi

    chown nobody:nogroup "$NFS_EXPORT_DIR"
    chmod 755 "$NFS_EXPORT_DIR"

    # 3. Configurar export (idempotente)
    local export_line="$NFS_EXPORT_DIR ${NFS_ALLOWED_NETWORK}(rw,sync,no_subtree_check,no_root_squash)"
    if grep -qF "$export_line" /etc/exports 2>/dev/null; then
        log_info "Export ya configurado en /etc/exports"
    else
        sed -i "\|^${NFS_EXPORT_DIR} |d" /etc/exports
        echo "$export_line" >> /etc/exports
        log_ok "Export añadido a /etc/exports:"
        echo "       $export_line"
    fi

    # 4. Aplicar
    exportfs -ra
    systemctl enable --now nfs-kernel-server 2>/dev/null || true
    systemctl restart nfs-kernel-server
    log_ok "Servidor NFS corriendo"

    # 5. Verificar export
    echo ""
    log_info "Exports activos:"
    showmount -e "$local_ip" 2>/dev/null || log_warn "showmount falló — verifica firewall (puerto 2049)"

    echo ""
    log_info "Verifica conectividad desde un cliente:"
    echo "       showmount -e ${local_ip}"

    echo ""
    log_info "Si falla, abre el firewall para NFS:"
    echo "       sudo ufw allow from ${NFS_ALLOWED_NETWORK} to any port nfs"
    echo "       sudo ufw allow from ${NFS_ALLOWED_NETWORK} to any port 111  # portmapper"
}

# ─── Cliente ──────────────────────────────────────────────────────────────────
setup_client() {
    local nfs_server="$1"
    log_info "Configurando cliente NFS → servidor ${nfs_server}..."
    require_root
    check_os

    # 1. Verificar conectividad con el servidor
    log_info "Verificando conectividad con servidor NFS..."
    if ! showmount -e "$nfs_server" &>/dev/null; then
        log_error "No se puede contactar al servidor NFS en ${nfs_server}."
        log_error ""
        log_error "Verifica:"
        log_error "  1. El servidor NFS está corriendo en ${nfs_server}"
        log_error "  2. El firewall permite puerto 2049 (nfs) y 111 (portmapper)"
        log_error "  3. La red ${NFS_ALLOWED_NETWORK} está autorizada en /etc/exports del servidor"
        log_error ""
        log_error "  Prueba manual: showmount -e ${nfs_server}"
        exit 1
    fi
    log_ok "Servidor NFS responde"

    # 2. Instalar paquetes
    log_info "Instalando nfs-common..."
    apt-get update -qq
    apt-get install -y -qq nfs-common

    # 3. Crear punto de montaje
    if [ ! -d "$NFS_MOUNT_POINT" ]; then
        mkdir -p "$NFS_MOUNT_POINT"
        log_ok "Punto de montaje creado: $NFS_MOUNT_POINT"
    else
        log_info "Punto de montaje ya existe: $NFS_MOUNT_POINT"
    fi

    # 4. Montar (si no está ya montado)
    if mountpoint -q "$NFS_MOUNT_POINT" 2>/dev/null; then
        log_info "NFS ya está montado en $NFS_MOUNT_POINT"
    else
        mount -t nfs "${nfs_server}:${NFS_EXPORT_DIR}" "$NFS_MOUNT_POINT"
        log_ok "NFS montado: ${nfs_server}:${NFS_EXPORT_DIR} → $NFS_MOUNT_POINT"
    fi

    # 5. Persistir en /etc/fstab (idempotente)
    local fstab_line="${nfs_server}:${NFS_EXPORT_DIR} ${NFS_MOUNT_POINT} nfs rw,hard,intr 0 0"
    if grep -qF "${nfs_server}:${NFS_EXPORT_DIR}" /etc/fstab 2>/dev/null; then
        log_info "Entrada NFS ya existe en /etc/fstab — actualizando"
        sed -i "\|${nfs_server}:${NFS_EXPORT_DIR}|c\\${fstab_line}" /etc/fstab
    else
        echo "$fstab_line" >> /etc/fstab
        log_ok "Entrada añadida a /etc/fstab"
    fi

    # 6. Prueba de escritura
    local test_file="${NFS_MOUNT_POINT}/.nfs-write-test-$$"
    if touch "$test_file" 2>/dev/null; then
        rm -f "$test_file"
        log_ok "Prueba de escritura exitosa en $NFS_MOUNT_POINT"
    else
        log_error "No se puede escribir en $NFS_MOUNT_POINT — revisa permisos del export en el servidor"
        exit 1
    fi

    echo ""
    log_info "NFS configurado correctamente."
    echo "       Montaje:  ${nfs_server}:${NFS_EXPORT_DIR} → ${NFS_MOUNT_POINT}"
    echo "       fstab:    persistente tras reinicio"
    echo "       Probar:   touch ${NFS_MOUNT_POINT}/testfile && rm ${NFS_MOUNT_POINT}/testfile"
}

# ─── Diagnóstico ──────────────────────────────────────────────────────────────
do_check() {
    log_info "Diagnóstico de NFS..."
    echo ""

    echo "→ IPs de esta máquina:"
    ip -4 addr show scope global | grep inet | awk '{print "   " $2}' || echo "   (no disponible)"

    echo ""
    echo "→ Paquetes instalados:"
    dpkg -l nfs-kernel-server 2>/dev/null | grep -q "^ii" && echo "   nfs-kernel-server: INSTALADO" || echo "   nfs-kernel-server: NO INSTALADO"
    dpkg -l nfs-common 2>/dev/null | grep -q "^ii" && echo "   nfs-common: INSTALADO" || echo "   nfs-common: NO INSTALADO"

    echo ""
    echo "→ Servicio NFS server:"
    systemctl is-active nfs-kernel-server 2>/dev/null || echo "   inactivo / no aplica"

    echo ""
    echo "→ Exports locales:"
    showmount -e localhost 2>/dev/null || echo "   no disponible"

    echo ""
    echo "→ Montajes NFS activos:"
    mount | grep nfs || echo "   ninguno"

    echo ""
    echo "→ /etc/exports (sin comentarios):"
    grep -v '^#' /etc/exports 2>/dev/null | grep -v '^$' || echo "   vacío"

    echo ""
    echo "→ Entrada NFS en /etc/fstab:"
    grep nfs /etc/fstab 2>/dev/null || echo "   ninguna"
}

# ─── Entry point ──────────────────────────────────────────────────────────────
usage() {
    echo "Uso:"
    echo "  $0 server                  Configurar esta máquina como servidor NFS"
    echo "  $0 client <IP_SERVIDOR>    Configurar esta máquina como cliente NFS"
    echo "  $0 check                   Diagnóstico de la configuración NFS actual"
    echo ""
    echo "Ejemplo (3 máquinas):"
    echo "  [servidor]  sudo $0 server"
    echo "  [cliente 1] sudo $0 client 10.0.0.3"
    echo "  [cliente 2] sudo $0 client 10.0.0.3"
    echo "  [cualquiera] $0 check"
}

case "${1:-}" in
    server)
        setup_server
        ;;
    client)
        if [ -z "${2:-}" ]; then
            log_error "Especifica la IP del servidor NFS: $0 client <IP>"
            exit 1
        fi
        setup_client "$2"
        ;;
    check)
        do_check
        ;;
    *)
        usage
        exit 1
        ;;
esac

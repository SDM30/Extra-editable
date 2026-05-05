import redis
import subprocess
import os
import time
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Configuración
# ──────────────────────────────────────────────────────────────────────────────
BASE_DIR             = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH        = os.getenv("NGINX_TEMPLATE_PATH",  os.path.join(BASE_DIR, "nginx_template.conf"))
NGINX_CONF_PATH      = os.getenv("NGINX_CONF_PATH",      os.path.join(BASE_DIR, "nginx.conf"))
POLL_INTERVAL        = int(os.getenv("POLL_INTERVAL", 15))

# Marcador dentro del template que será reemplazado por los servidores dinámicos
UPSTREAM_MARKER      = "# {{LSP_INSTANCES}}"

# ──────────────────────────────────────────────────────────────────────────────
# Cliente Redis
# ──────────────────────────────────────────────────────────────────────────────
r = redis.Redis(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    decode_responses=True
)


def load_template() -> str:
    """Carga el template desde nginx_template.conf al inicio del script."""
    if not os.path.exists(TEMPLATE_PATH):
        raise FileNotFoundError(f"Template no encontrado: {TEMPLATE_PATH}")
    with open(TEMPLATE_PATH, "r") as f:
        content = f.read()
    if UPSTREAM_MARKER not in content:
        raise ValueError(f"Marcador '{UPSTREAM_MARKER}' no encontrado en el template")
    logger.info("Template cargado desde: %s", TEMPLATE_PATH)
    return content


def get_live_instances() -> list[str]:
    """Retorna instancias vivas y elimina del set las que perdieron el heartbeat."""
    all_instances = r.smembers("lsp:instances")
    live = []
    dead = []

    for instance in all_instances:
        if r.exists(f"lsp:heartbeat:{instance}"):
            live.append(instance)
        else:
            dead.append(instance)

    # Limpiar instancias muertas del set para no acumular entradas huérfanas
    if dead:
        r.srem("lsp:instances", *dead)
        logger.info("Instancias eliminadas del registro (sin heartbeat): %s", dead)

    return live


def generate_and_reload(template: str, instances: list[str]):
    """Reemplaza el marcador en el template y recarga Nginx si la config es válida."""
    if not instances:
        logger.warning("No hay instancias activas — nginx.conf no se actualiza")
        return

    # Construir las líneas de servidor que reemplazan el marcador
    server_lines = "\n".join(
        f"        server {instance} max_fails=3 fail_timeout=30s;"
        for instance in instances
    )
    config = template.replace(UPSTREAM_MARKER, server_lines)

    with open(NGINX_CONF_PATH, "w") as f:
        f.write(config)

    # Validar antes de recargar
    result = subprocess.run(
        ["nginx", "-t", "-c", NGINX_CONF_PATH],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        logger.error("nginx -t falló — nginx.conf no se recargará:\n%s", result.stderr)
        return

    subprocess.run(["nginx", "-s", "reload"])
    logger.info("nginx.conf actualizado con %d instancias: %s", len(instances), instances)


if __name__ == "__main__":
    template = load_template()   # Se carga una sola vez al inicio

    logger.info("Iniciando watcher de instancias LSP (intervalo: %ds)", POLL_INTERVAL)
    last_instances: set | None = None

    while True:
        try:
            instances = get_live_instances()
            current = set(instances)

            if current != last_instances:
                logger.info("Cambio detectado: %s → %s", last_instances, current)
                generate_and_reload(template, instances)
                last_instances = current

        except redis.RedisError as e:
            logger.error("Redis error: %s", e)

        time.sleep(POLL_INTERVAL)
#!/usr/bin/env python3
# Para usar el venv local: ./venv/bin/python3 update_nginx.py
"""
Watcher de instancias del Servicio de Lenguaje.
Lee las instancias activas desde Redis (lsp:instances + heartbeat) y actualiza
nginx.conf. Si detecta cero instancias, publica un comando SPAWN vía Redis Pub/Sub
para que los agentes sidecar en cada nodo levanten sus contenedores LSP.
"""

import subprocess
import os
import time
import logging
import redis

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Configuración
# ──────────────────────────────────────────────────────────────────────────────
BASE_DIR             = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH        = os.getenv("NGINX_TEMPLATE_PATH",  os.path.join(BASE_DIR, "nginx_template.conf"))
NGINX_CONF_PATH      = os.getenv("NGINX_CONF_PATH",      os.path.join(BASE_DIR, "nginx.conf"))
POLL_INTERVAL        = int(os.getenv("POLL_INTERVAL", 2))

# Redis — service registry compartido
REDIS_HOST           = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT           = int(os.getenv("REDIS_PORT", 6379))
REDIS_DB             = int(os.getenv("REDIS_DB", 0))

# Marcador dentro del template que será reemplazado por los servidores dinámicos
UPSTREAM_MARKER      = "# {{LSP_INSTANCES}}"

# Auto-spawn: cuántos polls consecutivos vacíos antes de publicar SPAWN
_SPAWN_THRESHOLD     = 3
_EMPTY_STREAK        = 0

# Nginx — se ejecuta dentro del contenedor Docker lsp-lb
NGINX_CONTAINER = os.getenv("NGINX_CONTAINER", "lsp-lb")
_redis = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    db=REDIS_DB,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_timeout=5
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


def get_redis_instances() -> list[str]:
    """
    Lee lsp:instances (Set) de Redis y filtra por heartbeat vivo.
    Cada miembro del set tiene el formato "<ip>:<port>:<pid>".
    Solo se incluyen aquellos cuya key lsp:heartbeat:<id> existe (TTL activo).

    Retorna lista de "ip:puerto" ordenados numéricamente por puerto.
    """
    try:
        members = _redis.smembers("lsp:instances")
    except redis.RedisError as e:
        logger.error("Error leyendo lsp:instances de Redis: %s", e)
        return []

    live = []
    for member in members:
        try:
            ip, port, _ = member.rsplit(":", 2)
        except ValueError:
            logger.debug("Formato inesperado en lsp:instances: %s", member)
            continue
        if _redis.exists(f"lsp:heartbeat:{member}"):
            live.append(f"{ip}:{port}")

    return sorted(live, key=lambda x: int(x.split(":")[1]))


def maybe_spawn(live_instances: list[str]):
    """
    Si se detectan 0 instancias por _SPAWN_THRESHOLD polls consecutivos,
    publica un comando SPAWN en Redis Pub/Sub para que los agentes sidecar
    en cada nodo levanten sus contenedores LSP.
    """
    global _EMPTY_STREAK
    if live_instances:
        _EMPTY_STREAK = 0
        return
    _EMPTY_STREAK += 1
    if _EMPTY_STREAK >= _SPAWN_THRESHOLD:
        logger.critical("0 instancias por %d polls consecutivos — publicando SPAWN", _EMPTY_STREAK)
        try:
            _redis.publish("lb:lsp:commands", "SPAWN")
            logger.info("Comando SPAWN publicado en canal lb:lsp:commands")
        except redis.RedisError as e:
            logger.error("No se pudo publicar SPAWN en Redis: %s", e)
        _EMPTY_STREAK = 0


def generate_and_reload(template: str, instances: list[str]):
    """
    Reemplaza el marcador en el template con los servidores activos,
    valida la configuración y recarga Nginx.
    Si no hay instancias, el upstream queda sin backends (nginx responde 502).
    """
    if instances:
        server_lines = "\n".join(
            f"        server {instance} max_fails=3 fail_timeout=30s;"
            for instance in instances
        )
    else:
        server_lines = "        # sin backends — nginx devolverá 502"

    config = template.replace(UPSTREAM_MARKER, server_lines)

    # Escribir nueva configuración
    with open(NGINX_CONF_PATH, "w") as f:
        f.write(config)

    # Validar sintaxis antes de recargar (dentro del contenedor)
    result = subprocess.run(
        ["docker", "exec", NGINX_CONTAINER, "nginx", "-t"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        logger.error("nginx -t falló — nginx.conf no se recargará:\n%s", result.stderr)
        return

    # Recargar Nginx dentro del contenedor
    result = subprocess.run(
        ["docker", "exec", NGINX_CONTAINER, "nginx", "-s", "reload"],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        logger.info("nginx.conf actualizado con %d backends: %s", len(instances), instances or [])
    else:
        logger.error("Error al recargar Nginx: %s", result.stderr)


def print_banner(template: str):
    """Muestra información de inicio."""
    logger.info("=" * 55)
    logger.info("  LSP Load Balancer Watcher")
    logger.info("  Fuente: Redis (lsp:instances + heartbeat)")
    logger.info("  Redis: %s:%d", REDIS_HOST, REDIS_PORT)
    logger.info("  Intervalo: %ds", POLL_INTERVAL)
    logger.info("  Template: %s", TEMPLATE_PATH)
    logger.info("  Nginx conf: %s", NGINX_CONF_PATH)
    logger.info("  Canal SPAWN: lb:lsp:commands")
    logger.info("=" * 55)


if __name__ == "__main__":
    template = load_template()   # Se carga una sola vez al inicio
    print_banner(template)

    last_instances: set | None = None

    while True:
        try:
            # Obtener instancias vivas desde Redis
            live_instances = get_redis_instances()

            if not live_instances:
                logger.warning("0 instancias vivas — nginx sin backends")

            maybe_spawn(live_instances)

            current = set(live_instances)

            if current != last_instances:
                logger.info("Cambio detectado: %s → %s",
                           sorted(last_instances) if last_instances else "[]",
                           sorted(current))
                generate_and_reload(template, live_instances)
                last_instances = current

        except Exception as e:
            logger.error("Error en ciclo principal: %s", e)

        time.sleep(POLL_INTERVAL)
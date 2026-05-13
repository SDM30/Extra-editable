#!/usr/bin/env python3
"""
Watcher de instancias del Servicio de Lenguaje.
Lee los puertos mapeados por Docker (filtrando por label) y actualiza nginx.conf.
No depende de Redis para el descubrimiento de red.
"""

import subprocess
import os
import time
import re
import logging

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

# Filtros de Docker (solo contenedores del Servicio de Lenguaje)
DOCKER_LABEL         = os.getenv("DOCKER_LABEL", "lsp.service=api")
DOCKER_NAME_FILTER   = os.getenv("DOCKER_NAME_FILTER", "lsp-service-language-service")

# Marcador dentro del template que será reemplazado por los servidores dinámicos
UPSTREAM_MARKER      = "# {{LSP_INSTANCES}}"

# Puerto interno del API (para extraer el mapeo)
INTERNAL_PORT        = "8135"


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


def get_docker_ports() -> list[str]:
    """
    Obtiene los puertos mapeados de los contenedores del Servicio de Lenguaje.
    Filtra por label (lsp.service=api) y por nombre del contenedor.
    
    Retorna lista de "127.0.0.1:puerto" ordenados numéricamente.
    """
    try:
        # Intentar filtrar por label primero (más preciso)
        result = subprocess.run(
            ["docker", "ps", 
             "--filter", f"label={DOCKER_LABEL}",
             "--format", "{{.Ports}}"],
            capture_output=True, text=True, timeout=5
        )
        
        ports = set()
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            # Buscar patrón: "0.0.0.0:32801->8135/tcp" o "[::]:32801->8135/tcp"
            match = re.search(r'(?:0\.0\.0\.0|\[::\]):(\d+)->' + INTERNAL_PORT, line)
            if match:
                ports.add(f"127.0.0.1:{match.group(1)}")
        
        # Si no encontró por label, intentar por nombre (fallback)
        if not ports:
            logger.debug("Label no encontró contenedores, intentando por nombre...")
            result = subprocess.run(
                ["docker", "ps",
                 "--filter", f"name={DOCKER_NAME_FILTER}",
                 "--format", "{{.Ports}}"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                match = re.search(r'(?:0\.0\.0\.0|\[::\]):(\d+)->' + INTERNAL_PORT, line)
                if match:
                    ports.add(f"127.0.0.1:{match.group(1)}")
        
        return sorted(ports, key=lambda x: int(x.split(":")[1]))
    
    except subprocess.TimeoutExpired:
        logger.error("Timeout consultando Docker")
        return []
    except FileNotFoundError:
        logger.error("Comando 'docker' no encontrado. ¿Está instalado?")
        return []
    except Exception as e:
        logger.error("Error consultando Docker: %s", e)
        return []


def health_check(host_port: str) -> bool:
    """
    Verifica que la instancia responda correctamente.
    """
    try:
        result = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
             "--connect-timeout", "2", "--max-time", "3",
             f"http://{host_port}/lsp/"],
            capture_output=True, text=True, timeout=5
        )
        is_healthy = result.stdout.strip() in ("200", "404")  # 404 también es válido (sin contenedores LSP)
        if not is_healthy:
            logger.debug("Health check fallido para %s: HTTP %s", host_port, result.stdout.strip())
        return is_healthy
    except subprocess.TimeoutExpired:
        logger.debug("Timeout en health check para %s", host_port)
        return False
    except Exception as e:
        logger.debug("Error en health check para %s: %s", host_port, e)
        return False


def generate_and_reload(template: str, instances: list[str]):
    """
    Reemplaza el marcador en el template con los servidores activos,
    valida la configuración y recarga Nginx.
    """
    if not instances:
        logger.warning("No hay instancias activas — nginx.conf no se actualiza")
        return

    # Construir las líneas de servidor que reemplazan el marcador
    server_lines = "\n".join(
        f"        server {instance} max_fails=3 fail_timeout=30s;"
        for instance in instances
    )
    config = template.replace(UPSTREAM_MARKER, server_lines)

    # Escribir nueva configuración
    with open(NGINX_CONF_PATH, "w") as f:
        f.write(config)

    # Validar sintaxis antes de recargar
    result = subprocess.run(
        ["nginx", "-t", "-c", NGINX_CONF_PATH],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        logger.error("nginx -t falló — nginx.conf no se recargará:\n%s", result.stderr)
        return

    # Recargar Nginx
    result = subprocess.run(
        ["nginx", "-s", "reload"],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        logger.info("✅ nginx.conf actualizado con %d instancias: %s", len(instances), instances)
    else:
        logger.error("Error al recargar Nginx: %s", result.stderr)


def print_banner(template: str):
    """Muestra información de inicio."""
    logger.info("=" * 55)
    logger.info("  LSP Load Balancer Watcher")
    logger.info("  Fuente: Docker (label: %s)", DOCKER_LABEL)
    logger.info("  Intervalo: %ds", POLL_INTERVAL)
    logger.info("  Template: %s", TEMPLATE_PATH)
    logger.info("  Nginx conf: %s", NGINX_CONF_PATH)
    logger.info("=" * 55)


if __name__ == "__main__":
    template = load_template()   # Se carga una sola vez al inicio
    print_banner(template)

    last_instances: set | None = None

    while True:
        try:
            # Obtener puertos de Docker
            instances = get_docker_ports()
            
            # Filtrar solo las que pasan health check
            live_instances = [i for i in instances if health_check(i)]
            
            if not live_instances and instances:
                logger.warning("Se encontraron puertos pero ningún health check pasó: %s", instances)
            
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
# lifecycle.py
# Se comunica con Docker para crear, iniciar y destruir contenedores LSP.
# Soporta despliegue multi-máquina: los contenedores son "sticky" a la máquina
# que los creó. Operaciones sobre contenedores remotos se forwardean via HTTP.
import logging
import os
import time
import docker
import httpx
from docker.errors import DockerException, ImageNotFound, APIError
from app.services import registry

logger = logging.getLogger(__name__)
_client = None

LANGUAGES = ["python", "cpp", "typescript"]
LSPMUX_INTERNAL_PORT = 3000  # Puerto interno del contenedor


def _get_local_host() -> str:
    """Retorna el identificador de esta máquina (WS_PUBLIC_HOST)."""
    return os.environ.get("WS_PUBLIC_HOST", "127.0.0.1")


def _is_local(entry: dict) -> bool:
    """True si el contenedor vive en el Docker daemon de esta máquina."""
    if not entry:
        return False
    return entry.get("host", _get_local_host()) == _get_local_host()


def _forward_destroy_to_host(host: str, project_id: str, language: str) -> bool:
    """Reenvía la orden de destrucción a la máquina dueña del contenedor."""
    port = os.environ.get("INTERNAL_API_PORT", "8135")
    secret = os.environ.get("LSP_INTERNAL_SECRET", "")
    url = f"http://{host}:{port}/lsp/{project_id}/_internal/destroy?language={language}"
    headers = {}
    if secret:
        headers["X-LSP-Internal"] = secret
    try:
        resp = httpx.delete(url, headers=headers, timeout=10.0)
        return resp.status_code == 200
    except httpx.RequestError as e:
        logger.error("Error forwardeando destroy a %s: %s", host, e)
        return False

def _get_client():
    global _client
    if _client is not None:
        return _client
    try:
        _client = docker.from_env()
        return _client
    except Exception as e:
        logger.exception("Error conectando con Docker")
        raise RuntimeError(f"Docker no disponible: {e}")

def create_container(project_id: str, language: str, max_clients: int = 4):
    """Crea un contenedor LSP multiplexor para el proyecto.

    Si el proyecto+lenguaje ya existe en otra máquina, retorna la entrada del
    registry sin crear duplicados.  Si existe localmente pero el contenedor
    Docker murió, lo recrea."""
    if language not in LANGUAGES:
        raise ValueError(f"Lenguaje no soportado: {language}. Usa: {LANGUAGES}")

    ws_public_host = _get_local_host()
    idle_timeout = os.environ.get("CONTAINER_IDLE_TIMEOUT", "300000")
    client = _get_client()

    # Recuperación: si el servicio reinició, el registry se perdió (caso
    # anterior a Redis) pero el contenedor puede seguir existiendo localmente.
    try:
        found = client.containers.list(
            all=True,
            filters={
                "label": [
                    f"project_id={project_id}",
                    f"language={language}",
                    "type=lsp-multiplexor"
                ]
            }
        )
        if found:
            container = found[0]
            container.reload()
            if container.status == "running":
                port_mapping = container.attrs["NetworkSettings"]["Ports"][f"{LSPMUX_INTERNAL_PORT}/tcp"]
                if port_mapping:
                    host_port = int(port_mapping[0]["HostPort"])
                    ws_url = f"ws://{ws_public_host}:{host_port}"
                    registry.add(
                        project_id=project_id,
                        language=language,
                        container_id=container.id,
                        ws_port=host_port,
                        ws_url=ws_url,
                        max_clients=int(container.labels.get("max_clients", max_clients)),
                        host=ws_public_host,
                    )
                    logger.info(f"Contenedor existente detectado por labels: {container.id[:12]} - WS: {ws_url}")
                    return registry.get(project_id, language)
            else:
                logger.warning(f"Contenedor encontrado por labels pero no está corriendo ({container.status}); eliminando...")
                container.remove(force=True)
    except Exception as e:
        logger.warning("No se pudo recuperar contenedor por labels: %s", e)

    # Si ya existe entrada en registry, verificar si es local o remoto
    if registry.exists(project_id, language):
        existing = registry.get(project_id, language)
        # Contenedor remoto: retornar tal cual (no podemos gestionarlo localmente)
        if not _is_local(existing):
            logger.info("Contenedor remoto existente para %s (%s) en %s",
                        project_id, language, existing.get("host"))
            return existing
        # Contenedor local: verificar que el contenedor Docker siga vivo
        try:
            container = client.containers.get(existing["container_id"])
            if container.status == "running":
                logger.info(f"Contenedor existente para {project_id} ({language}) está corriendo")
                return existing
            else:
                logger.warning(f"Contenedor existente para {project_id} ({language}) no está corriendo, recreando...")
                destroy_container_local(project_id, language)
        except Exception as e:
            # Contenedor no existe o Docker no responde — limpiar registro stale
            # y permitir que el flujo normal recree el contenedor.
            logger.exception("Error verificando contenedor existente para %s (%s): %s",
                           project_id, language, e)
            registry.remove(project_id, language)

    # Crea la carpeta del proyecto si no existe
    projects_dir = os.environ.get("PROJECTS_DIR") or os.path.expanduser("~/projects")
    project_path = os.path.join(projects_dir, project_id)
    os.makedirs(project_path, exist_ok=True)

    image = "lsp-multiplexor:latest"
    
    try:
        client.images.get(image)
    except ImageNotFound:
        try:
            image = "lsp-server:latest"
            client.images.get(image)
            logger.warning(f"Usando imagen alternativa: {image}")
        except ImageNotFound:
            raise ValueError(
                f"No existe la imagen Docker `lsp-multiplexor:latest` ni `lsp-server:latest`. "
                "Constrúyela primero con: `cd lsp-container && docker build -t lsp-multiplexor:latest .`"
            )

    try:
        container = client.containers.run(
            image,
            detach=True,
            name=f"lsp-{project_id}-{language}",
            environment={
                "LANGUAGE": language,
                "MAX_CLIENTS": str(max_clients),
                "IDLE_TIMEOUT": idle_timeout,
                "WORKDIR": "/workspace",
                "LSPMUX_PORT": str(LSPMUX_INTERNAL_PORT),
                "PROJECT_ID": project_id,
                "JWT_SECRET": os.getenv("JWT_SECRET", "jwt-secreto"),
            },
            volumes={
                project_path: {
                    "bind": "/workspace",
                    "mode": "rw"
                }
            },
            ports={
                f"{LSPMUX_INTERNAL_PORT}/tcp": None
            },
            labels={
                "project_id": project_id,
                "language": language,
                "max_clients": str(max_clients),
                "type": "lsp-multiplexor"
            },
            remove=False
        )
        
        time.sleep(1)
        container.reload()
        
        port_mapping = container.attrs["NetworkSettings"]["Ports"][f"{LSPMUX_INTERNAL_PORT}/tcp"]
        if not port_mapping:
            raise RuntimeError(f"No se pudo obtener el puerto mapeado")
        
        host_port = int(port_mapping[0]["HostPort"])
        ws_url = f"ws://{ws_public_host}:{host_port}"
        
        logger.info(f"Contenedor {container.id[:12]} creado - WS: {ws_url}")
        
        registry.add(
            language=language,
            project_id=project_id,
            container_id=container.id,
            ws_port=host_port,
            ws_url=ws_url,
            max_clients=max_clients,
            host=ws_public_host,
        )
        
        return registry.get(project_id, language)
        
    except Exception as e:
        logger.exception(f"Error al crear contenedor para {project_id}")
        raise RuntimeError(f"Error al crear contenedor: {e}")


def destroy_container(project_id: str, language: str) -> bool:
    """Destruye el contenedor LSP de un proyecto+lenguaje.

    Si el contenedor pertenece a otra máquina, forwardea la operación a la
    máquina dueña via HTTP.  Si es local, lo elimina directamente."""
    entry = registry.get(project_id, language)
    if not entry:
        return False

    if not _is_local(entry):
        logger.info("Forwardeando destroy de %s/%s a %s",
                    project_id, language, entry["host"])
        return _forward_destroy_to_host(entry["host"], project_id, language)

    return destroy_container_local(project_id, language)


def destroy_container_local(project_id: str, language: str) -> bool:
    """Destruye localmente un contenedor LSP (sin validación cross-machine).

    Usado internamente por `destroy_container` y por el endpoint
    `/_internal/destroy` que recibe requests forwardeados de otras máquinas."""
    entry = registry.get(project_id, language)
    if not entry:
        return False

    client = _get_client()
    try:
        container = client.containers.get(entry["container_id"])
        container.remove(force=True)
    except Exception as e:
        logger.error(f"Error al eliminar contenedor: {e}")
    
    registry.remove(project_id, language)
    return True


def get_status(project_id: str, language: str) -> dict:
    """Retorna el estado del contenedor LSP de un proyecto+lenguaje.

    Para contenedores remotos retorna la info del registry con status='remote'
    ya que no puede consultar el Docker daemon de otra máquina."""
    entry = registry.get(project_id, language)
    if not entry:
        return {"status": "not_found"}

    if not _is_local(entry):
        return {
            "project_id": project_id,
            "container_id": entry.get("container_id", "")[:12],
            "language": entry.get("language"),
            "status": "remote",
            "host": entry.get("host"),
            "ws_url": entry.get("ws_url"),
            "ws_port": entry.get("ws_port"),
            "max_clients": entry.get("max_clients", 4)
        }

    client = _get_client()
    try:
        container = client.containers.get(entry["container_id"])
        return {
            "project_id": project_id,
            "container_id": entry["container_id"][:12],
            "language": entry["language"],
            "status": container.status,
            "ws_url": entry.get("ws_url"),
            "ws_port": entry.get("ws_port"),
            "max_clients": entry.get("max_clients", 4),
            "host": entry.get("host"),
        }
    except Exception as e:
        return {
            "project_id": project_id,
            "container_id": entry["container_id"][:12],
            "language": entry["language"],
            "status": "error",
            "error": str(e),
            "host": entry.get("host"),
        }


def get_container_logs(project_id: str, language: str, tail: int = 100) -> str:
    """Obtiene los logs del contenedor para debugging.

    Para contenedores remotos forwardea la petición a la máquina dueña."""
    entry = registry.get(project_id, language)
    if not entry:
        return "Contenedor no encontrado"

    if not _is_local(entry):
        return _forward_get_logs(entry["host"], project_id, language, tail)

    client = _get_client()
    try:
        container = client.containers.get(entry["container_id"])
        logs = container.logs(tail=tail).decode('utf-8')
        return logs
    except Exception as e:
        return f"Error obteniendo logs: {e}"


def _forward_get_logs(host: str, project_id: str, language: str, tail: int) -> str:
    """Forwardea la petición de logs al host dueño del contenedor."""
    port = os.environ.get("INTERNAL_API_PORT", "8135")
    secret = os.environ.get("LSP_INTERNAL_SECRET", "")
    url = f"http://{host}:{port}/lsp/{project_id}/logs?language={language}&tail={tail}"
    headers = {}
    if secret:
        headers["X-LSP-Internal"] = secret
    try:
        resp = httpx.get(url, headers=headers, timeout=10.0)
        if resp.status_code == 200:
            return resp.json().get("logs", str(resp.content))
        return f"Error forwardeando logs: HTTP {resp.status_code}"
    except httpx.RequestError as e:
        return f"Error forwardeando logs a {host}: {e}"

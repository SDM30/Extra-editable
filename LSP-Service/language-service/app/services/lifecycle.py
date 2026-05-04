# lifecycle.py
# Se comunica con Docker para crear, iniciar y destruir contenedores LSP.
import logging
import os
import time
import docker
from docker.errors import DockerException, ImageNotFound, APIError
from app.services import registry

logger = logging.getLogger(__name__)
_client = None

LANGUAGES = ["python", "cpp", "typescript"]
LSPMUX_INTERNAL_PORT = 3000  # Puerto interno del contenedor

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
    """Crea un contenedor LSP multiplexor para el proyecto."""
    if language not in LANGUAGES:
        raise ValueError(f"Lenguaje no soportado: {language}. Usa: {LANGUAGES}")

    ws_public_host = os.environ.get("WS_PUBLIC_HOST", "127.0.0.1")
    idle_timeout = os.environ.get("CONTAINER_IDLE_TIMEOUT", "300000")

    client = _get_client()

    # Recuperación: si el servicio reinició, el registry (en memoria) se pierde,
    # pero el contenedor puede seguir existiendo. Detectarlo por labels.
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
                        max_clients=int(container.labels.get("max_clients", max_clients))
                    )
                    logger.info(f"Contenedor existente detectado por labels: {container.id[:12]} - WS: {ws_url}")
                    return registry.get(project_id, language)
            else:
                logger.warning(f"Contenedor encontrado por labels pero no está corriendo ({container.status}); eliminando...")
                container.remove(force=True)
    except Exception as e:
        logger.warning(f"No se pudo recuperar contenedor por labels: {e}")

    if registry.exists(project_id, language):
        existing = registry.get(project_id, language)
        try:
            container = client.containers.get(existing["container_id"])
            if container.status == "running":
                logger.info(f"Contenedor existente para {project_id} ({language}) está corriendo")
                return existing
            else:
                logger.warning(f"Contenedor existente para {project_id} ({language}) no está corriendo, recreando...")
                destroy_container(project_id, language)
        except Exception as e:
            logger.error(f"Error verificando contenedor existente: {e}")
            registry.remove(project_id, language)

    # Crea la carpeta del proyecto si no existe
    projects_dir = os.environ.get("PROJECTS_DIR") or os.path.expanduser("~/projects")
    project_path = os.path.join(projects_dir, project_id)
    os.makedirs(project_path, exist_ok=True)

    image = "lsp-multiplexor:latest"
    
    try:
        client.images.get(image)
    except ImageNotFound:
        # Si no existe lsp-multiplexor, intentar con lsp-server
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
                "LSPMUX_PORT": str(LSPMUX_INTERNAL_PORT)
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
            max_clients=max_clients
        )
        
        return registry.get(project_id, language)
        
    except Exception as e:
        logger.exception(f"Error al crear contenedor para {project_id}")
        raise RuntimeError(f"Error al crear contenedor: {e}")


def destroy_container(project_id: str, language: str) -> bool:
    """Destruye el contenedor LSP de un proyecto+lenguaje."""
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
    """Retorna el estado del contenedor LSP de un proyecto+lenguaje."""
    entry = registry.get(project_id, language)
    if not entry:
        return {"status": "not_found"}

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
            "max_clients": entry.get("max_clients", 4)
        }
    except Exception as e:
        return {
            "project_id": project_id,
            "container_id": entry["container_id"][:12],
            "language": entry["language"],
            "status": "error",
            "error": str(e)
        }


def get_container_logs(project_id: str, language: str, tail: int = 100) -> str:
    """Obtiene los logs del contenedor para debugging."""
    entry = registry.get(project_id, language)
    if not entry:
        return "Contenedor no encontrado"
    
    client = _get_client()
    try:
        container = client.containers.get(entry["container_id"])
        logs = container.logs(tail=tail).decode('utf-8')
        return logs
    except Exception as e:
        return f"Error obteniendo logs: {e}"

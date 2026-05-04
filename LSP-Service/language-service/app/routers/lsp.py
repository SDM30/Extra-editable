# lsp.py
# Define los endpoints HTTP que expone el servicio.

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional
from app.services import lifecycle
from app.services import registry

router = APIRouter(prefix="/lsp", tags=["lsp"])

class CreateRequest(BaseModel):
    language: str = Field(..., description="Lenguaje de programación (python, cpp, typescript)")
    max_clients: Optional[int] = Field(4, ge=1, le=10, description="Número máximo de clientes concurrentes")

class CreateResponse(BaseModel):
    message: str
    project_id: str
    container_id: str
    language: str
    ws_url: str
    ws_port: int
    max_clients: int

class StatusResponse(BaseModel):
    project_id: str
    container_id: Optional[str] = None
    language: Optional[str] = None
    status: str
    ws_url: Optional[str] = None
    ws_port: Optional[int] = None
    max_clients: Optional[int] = None
    active_connections: Optional[int] = None
    created_at: Optional[str] = None

@router.post("/{project_id}", response_model=CreateResponse)
def create_lsp(project_id: str, body: CreateRequest):
    """
    Crea un contenedor LSP multiplexor para el proyecto.
    
    El contenedor expone un WebSocket en `ws_url` que puede ser usado por hasta
    `max_clients` clientes concurrentes que compartirán la misma instancia del LSP.
    """
    try:
        container_info = lifecycle.create_container(
            project_id, 
            body.language,
            max_clients=body.max_clients
        )
        
        return {
            "message": f"Contenedor LSP creado exitosamente (máx {body.max_clients} clientes)",
            "project_id": project_id,
            "container_id": container_info["container_id"][:12],
            "language": body.language,
            "ws_url": container_info["ws_url"],
            "ws_port": container_info["ws_port"],
            "max_clients": body.max_clients
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.delete("/{project_id}")
def destroy_lsp(project_id: str, language: Optional[str] = Query(None, description="Lenguaje (python, cpp, typescript)")):
    """Destruye el contenedor LSP de un proyecto."""
    try:
        if language is None:
            langs = registry.list_languages(project_id)
            if not langs:
                raise HTTPException(status_code=404, detail=f"No existe contenedor para {project_id}")
            if len(langs) > 1:
                raise HTTPException(status_code=400, detail=f"Hay múltiples lenguajes activos para {project_id}. Especifica ?language=...")
            language = next(iter(langs.keys()))

        deleted = lifecycle.destroy_container(project_id, language)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"No existe contenedor para {project_id} ({language})")
        
        return {
            "message": "Contenedor eliminado exitosamente",
            "project_id": project_id,
            "language": language
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/{project_id}", response_model=StatusResponse)
def get_status(project_id: str, language: Optional[str] = Query(None, description="Lenguaje (python, cpp, typescript)")):
    """Retorna el estado detallado del contenedor LSP de un proyecto."""
    try:
        if language is None:
            langs = registry.list_languages(project_id)
            if not langs:
                return {"status": "not_found"}
            if len(langs) > 1:
                raise HTTPException(status_code=400, detail=f"Hay múltiples lenguajes activos para {project_id}. Especifica ?language=...")
            language = next(iter(langs.keys()))

        return lifecycle.get_status(project_id, language)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/{project_id}/logs")
def get_logs(
    project_id: str,
    tail: int = Query(100, description="Número de líneas de log a retornar"),
    language: Optional[str] = Query(None, description="Lenguaje (python, cpp, typescript)")
):
    """Obtiene los logs del contenedor para debugging."""
    try:
        if language is None:
            langs = registry.list_languages(project_id)
            if not langs:
                raise HTTPException(status_code=404, detail=f"No existe contenedor para {project_id}")
            if len(langs) > 1:
                raise HTTPException(status_code=400, detail=f"Hay múltiples lenguajes activos para {project_id}. Especifica ?language=...")
            language = next(iter(langs.keys()))

        logs = lifecycle.get_container_logs(project_id, language, tail=tail)
        return {"project_id": project_id, "logs": logs}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/")
def list_all():
    """Lista todos los contenedores activos con su información detallada."""
    containers = registry.get_all()
    
    # Enriquecer con estado actual
    detailed_list = []
    for project_id, langs in containers.items():
        for language in langs.keys():
            try:
                status = lifecycle.get_status(project_id, language)
                detailed_list.append(status)
            except Exception as e:
                detailed_list.append({
                    "project_id": project_id,
                    "language": language,
                    "status": "error",
                    "error": str(e)
                })
    
    return {
        "total": len(detailed_list),
        "containers": detailed_list
    }


@router.post("/cleanup")
def cleanup_inactive(idle_timeout: int = Query(1800, description="Timeout de inactividad en segundos")):
    """
    Limpia contenedores inactivos.
    Útil para liberar recursos automáticamente.
    """
    cleaned = lifecycle.cleanup_inactive_containers(idle_timeout)
    return {
        "message": f"Limpieza completada",
        "containers_cleaned": cleaned
    }

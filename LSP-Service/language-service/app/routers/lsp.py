# lsp.py
# Define los endpoints HTTP que expone el servicio.
# Incluye endpoints públicos (REST) y un endpoint interno para operaciones
# cross-machine (/_internal/destroy) usado por otras instancias del servicio.

import os
from fastapi import APIRouter, HTTPException, Query, Header, Depends
from pydantic import BaseModel, Field
from typing import Optional
from app.services import lifecycle
from app.services import registry
from app.auth import verify_lsp_access, verify_lsp_token_for_project

router = APIRouter(prefix="/lsp", tags=["lsp"])

class CreateRequest(BaseModel):
    language: str = Field(..., description="Lenguaje de programación (python, cpp, typescript)")
    max_clients: Optional[int] = Field(4, ge=1, le=10, description="Número máximo de clientes concurrentes")

class CreateResponse(BaseModel):
    message: str
    project_id: str
    container_id: str
    language: str
    host: str
    ws_url: str
    ws_port: int
    max_clients: int

class StatusResponse(BaseModel):
    project_id: str
    container_id: Optional[str] = None
    language: Optional[str] = None
    status: str
    host: Optional[str] = None
    ws_url: Optional[str] = None
    ws_port: Optional[int] = None
    max_clients: Optional[int] = None
    active_connections: Optional[int] = None
    created_at: Optional[str] = None

@router.post("/{project_id}", response_model=CreateResponse)
def create_lsp(
    project_id: str,
    body: CreateRequest,
    user: dict = Depends(verify_lsp_token_for_project),
):
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
            "host": container_info.get("host", ""),
            "ws_url": container_info["ws_url"],
            "ws_port": container_info["ws_port"],
            "max_clients": body.max_clients
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.delete("/{project_id}")
def destroy_lsp(
    project_id: str,
    language: Optional[str] = Query(None, description="Lenguaje (python, cpp, typescript)"),
    user: dict = Depends(verify_lsp_token_for_project),
):
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
def get_status(
    project_id: str,
    language: Optional[str] = Query(None, description="Lenguaje (python, cpp, typescript)"),
    user: dict = Depends(verify_lsp_token_for_project),
):
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
    language: Optional[str] = Query(None, description="Lenguaje (python, cpp, typescript)"),
    user: dict = Depends(verify_lsp_token_for_project),
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
def list_all(user: dict = Depends(verify_lsp_access)):
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
def cleanup_inactive(
    idle_timeout: int = Query(1800, description="Timeout de inactividad en segundos"),
    user: dict = Depends(verify_lsp_access),
):
    """
    Limpia contenedores inactivos.
    Útil para liberar recursos automáticamente.
    """
    cleaned = lifecycle.cleanup_inactive_containers(idle_timeout)
    return {
        "message": f"Limpieza completada",
        "containers_cleaned": cleaned
    }


@router.delete("/{project_id}/_internal/destroy")
def internal_destroy(
    project_id: str,
    language: str = Query(..., description="Lenguaje (python, cpp, typescript)"),
    x_lsp_internal: Optional[str] = Header(None, alias="X-LSP-Internal")
):
    """
    Endpoint interno para que otras instancias del servicio puedan
    destruir contenedores en esta máquina.
    
    Usado por el mecanismo de forward cross-machine. Solo accesible desde
    la red interna. Si se configura LSP_INTERNAL_SECRET, requiere el header
    X-LSP-Internal con el secreto correcto.
    """
    expected_secret = os.environ.get("LSP_INTERNAL_SECRET", "")
    if expected_secret and x_lsp_internal != expected_secret:
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        deleted = lifecycle.destroy_container_local(project_id, language)
        if not deleted:
            raise HTTPException(status_code=404, detail="No existe el contenedor")
        return {
            "message": "Contenedor eliminado (forward cross-machine)",
            "project_id": project_id,
            "language": language
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

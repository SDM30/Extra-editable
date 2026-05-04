# registry.py
# Mantiene en memoria el registro de todos los contenedores LSP activos.

from datetime import datetime
from typing import Optional, Dict, Any

_registry: Dict[str, Dict[str, Dict[str, Any]]] = {}

def add(project_id: str, language: str, container_id: str,
        ws_port: int = None, ws_url: str = None, max_clients: int = 4):
    """Registra un contenedor nuevo."""
    _registry.setdefault(project_id, {})[language] = {
        "container_id": container_id,
        "language": language,
        "ws_port": ws_port,
        "ws_url": ws_url,
        "max_clients": max_clients,
        "created_at": datetime.utcnow().isoformat()
    }

def get(project_id: str, language: str) -> Optional[Dict[str, Any]]:
    """Retorna la info del contenedor de un proyecto+lenguaje, o None si no existe."""
    return _registry.get(project_id, {}).get(language)

def remove(project_id: str, language: str):
    """Elimina el registro de un proyecto+lenguaje."""
    langs = _registry.get(project_id)
    if not langs:
        return
    langs.pop(language, None)
    if not langs:
        _registry.pop(project_id, None)

def get_all() -> dict:
    """Retorna todos los contenedores activos agrupados por proyecto y lenguaje."""
    return dict(_registry)

def list_languages(project_id: str) -> Dict[str, Dict[str, Any]]:
    """Retorna el mapa language -> entry para un proyecto."""
    return dict(_registry.get(project_id, {}))

def exists(project_id: str, language: str) -> bool:
    """Verifica si un proyecto+lenguaje ya tiene un contenedor activo."""
    return language in _registry.get(project_id, {})

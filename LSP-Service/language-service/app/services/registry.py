# registry.py
# Mantiene el registro de todos los contenedores LSP activos en Redis,
# permitiendo que múltiples instancias del Servicio de Lenguaje compartan
# el mismo estado sin duplicar contenedores por proyecto+lenguaje.

import json
import os
import logging
from datetime import datetime
from typing import Optional, Dict, Any

import redis

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Cliente Redis
# Se configura con variables de entorno para facilitar el despliegue.
# Valores por defecto apuntan a una instancia local estándar.
# ──────────────────────────────────────────────────────────────────────────────
_redis_client: Optional[redis.Redis] = None

def _get_redis() -> redis.Redis:
    """Retorna el cliente Redis, inicializándolo si es necesario."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis(
            host=os.getenv("REDIS_HOST", "localhost"),
            port=int(os.getenv("REDIS_PORT", 6379)),
            db=int(os.getenv("REDIS_DB", 0)),
            password=os.getenv("REDIS_PASSWORD", None),
            decode_responses=True,          # Siempre retorna str, no bytes
            socket_connect_timeout=5,
            socket_timeout=5,
        )
    return _redis_client


# ──────────────────────────────────────────────────────────────────────────────
# Helpers de clave
# Estructura: lsp:container:<project_id>:<language>
# Usar project_id y language como partes de la clave permite hacer lookups
# exactos sin deserializar ni escanear todo el registro.
# ──────────────────────────────────────────────────────────────────────────────
_PREFIX = "lsp:container"

def _key(project_id: str, language: str) -> str:
    return f"{_PREFIX}:{project_id}:{language}"

def _project_pattern(project_id: str) -> str:
    return f"{_PREFIX}:{project_id}:*"

def _all_pattern() -> str:
    return f"{_PREFIX}:*:*"


# ──────────────────────────────────────────────────────────────────────────────
# API pública  —  misma interfaz que la versión en memoria
# ──────────────────────────────────────────────────────────────────────────────

def add(project_id: str, language: str, container_id: str,
        ws_port: int = None, ws_url: str = None, max_clients: int = 4,
        host: str = None):
    """Registra un contenedor nuevo en Redis.

    El campo `host` identifica la máquina dueña del contenedor. Si no se
    especifica, se toma de la variable de entorno WS_PUBLIC_HOST, permitiendo
    que múltiples máquinas compartan el registro sin colisiones."""
    entry = {
        "container_id": container_id,
        "language": language,
        "ws_port": ws_port,
        "ws_url": ws_url,
        "max_clients": max_clients,
        "host": host or os.environ.get("WS_PUBLIC_HOST", "127.0.0.1"),
        "created_at": datetime.utcnow().isoformat(),
    }
    try:
        _get_redis().set(_key(project_id, language), json.dumps(entry))
        logger.debug("Registered container %s for %s/%s", container_id, project_id, language)
    except redis.RedisError as e:
        logger.error("Redis error on add(%s, %s): %s", project_id, language, e)
        raise


def get(project_id: str, language: str) -> Optional[Dict[str, Any]]:
    """Retorna la info del contenedor de un proyecto+lenguaje, o None si no existe."""
    try:
        raw = _get_redis().get(_key(project_id, language))
        return json.loads(raw) if raw else None
    except redis.RedisError as e:
        logger.error("Redis error on get(%s, %s): %s", project_id, language, e)
        return None


def remove(project_id: str, language: str):
    """Elimina el registro de un proyecto+lenguaje."""
    try:
        _get_redis().delete(_key(project_id, language))
        logger.debug("Removed container for %s/%s", project_id, language)
    except redis.RedisError as e:
        logger.error("Redis error on remove(%s, %s): %s", project_id, language, e)
        raise


def get_all() -> Dict[str, Dict[str, Dict[str, Any]]]:
    """Retorna todos los contenedores activos agrupados por proyecto y lenguaje.
    
    Reconstruye la misma estructura anidada { project_id: { language: entry } }
    que devolvía la versión en memoria.
    """
    result: Dict[str, Dict[str, Any]] = {}
    try:
        r = _get_redis()
        keys = r.keys(_all_pattern())
        if not keys:
            return result

        # Pipeline para obtener todos los valores en una sola ida a Redis
        pipe = r.pipeline()
        for k in keys:
            pipe.get(k)
        values = pipe.execute()

        for k, raw in zip(keys, values):
            if not raw:
                continue
            # Clave tiene forma: lsp:container:<project_id>:<language>
            parts = k.split(":", 3)          # ["lsp", "container", project_id, language]
            if len(parts) != 4:
                continue
            _, _, project_id, language = parts
            result.setdefault(project_id, {})[language] = json.loads(raw)

    except redis.RedisError as e:
        logger.error("Redis error on get_all: %s", e)

    return result


def list_languages(project_id: str) -> Dict[str, Dict[str, Any]]:
    """Retorna el mapa language -> entry para un proyecto."""
    result: Dict[str, Any] = {}
    try:
        r = _get_redis()
        keys = r.keys(_project_pattern(project_id))
        if not keys:
            return result

        pipe = r.pipeline()
        for k in keys:
            pipe.get(k)
        values = pipe.execute()

        for k, raw in zip(keys, values):
            if not raw:
                continue
            language = k.split(":")[-1]
            result[language] = json.loads(raw)

    except redis.RedisError as e:
        logger.error("Redis error on list_languages(%s): %s", project_id, e)

    return result


def exists(project_id: str, language: str) -> bool:
    """Verifica si un proyecto+lenguaje ya tiene un contenedor activo."""
    try:
        return _get_redis().exists(_key(project_id, language)) == 1
    except redis.RedisError as e:
        logger.error("Redis error on exists(%s, %s): %s", project_id, language, e)
        return False

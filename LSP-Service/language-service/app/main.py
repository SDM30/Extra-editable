import asyncio
import logging
import os
import socket

import redis
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import lsp
from fastapi.responses import JSONResponse
from app.services import health as health_service

from app.routers import lsp

# ──────────────────────────────────────────────────────────────────────────────
# Variables de entorno
# ──────────────────────────────────────────────────────────────────────────────
load_dotenv()

PROJECTS_DIR   = os.getenv("PROJECTS_DIR", os.path.expanduser("~/projects"))
HOST_IP = os.getenv("HOST_IP", "127.0.0.1")
WS_PUBLIC_HOST = os.getenv("WS_PUBLIC_HOST", HOST_IP)
# Puerto en el que corre esta instancia — debe pasarse como variable de entorno
# al lanzar cada réplica: PORT=8135 uvicorn app.main:app --port 8135
INSTANCE_PORT  = int(os.getenv("PORT", 8135))

# ──────────────────────────────────────────────────────────────────────────────
# Cliente Redis (compartido con registry.py)
# ──────────────────────────────────────────────────────────────────────────────
_redis = redis.Redis(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    db=int(os.getenv("REDIS_DB", 0)),
    password=os.getenv("REDIS_PASSWORD", None),
    decode_responses=True,
    socket_connect_timeout=5,
    socket_timeout=5,
)

_SERVICE_KEY  = "lsp:instances"           # Set con todas las instancias registradas
_HEARTBEAT_TTL = 30                        # segundos antes de que expire el heartbeat
_HEARTBEAT_INTERVAL = 10                   # segundos entre renovaciones

logger = logging.getLogger(__name__)


def _get_instance_id() -> str:
    """Identificador único de esta instancia: <ip>:<puerto>:<pid>."""
    host_ip = socket.gethostbyname(socket.gethostname())
    pid = os.getpid()
    return f"{host_ip}:{INSTANCE_PORT}:{pid}"


async def _heartbeat(instance_id: str):
    """Renueva el TTL del heartbeat cada _HEARTBEAT_INTERVAL segundos
    para indicar al balanceador que esta instancia sigue viva."""
    while True:
        try:
            _redis.setex(f"lsp:heartbeat:{instance_id}", _HEARTBEAT_TTL, "alive")
        except redis.RedisError as e:
            logger.error("Heartbeat error para %s: %s", instance_id, e)
        await asyncio.sleep(_HEARTBEAT_INTERVAL)


# ──────────────────────────────────────────────────────────────────────────────
# Aplicación
# ──────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="LSP Management Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(lsp.router)


@app.on_event("startup")
async def register_instance():
    """Registra esta instancia en Redis y arranca el heartbeat."""
    instance_id = _get_instance_id()
    try:
        _redis.sadd(_SERVICE_KEY, instance_id)
        _redis.setex(f"lsp:heartbeat:{instance_id}", _HEARTBEAT_TTL, "alive")
        asyncio.create_task(_heartbeat(instance_id))
        logger.info("Instancia registrada en Redis: %s", instance_id)
    except redis.RedisError as e:
        # No bloquea el arranque del servicio si Redis no está disponible
        logger.error("No se pudo registrar la instancia en Redis: %s", e)


@app.on_event("shutdown")
async def deregister_instance():
    """Elimina esta instancia del registro al apagarse."""
    instance_id = _get_instance_id()
    try:
        _redis.srem(_SERVICE_KEY, instance_id)
        _redis.delete(f"lsp:heartbeat:{instance_id}")
        logger.info("Instancia eliminada de Redis: %s", instance_id)
    except redis.RedisError as e:
        logger.error("No se pudo desregistrar la instancia en Redis: %s", e)


@app.get("/health")
def health():
    return health_service.liveness()


@app.get("/ready")
def ready():
    result = health_service.readiness()
    status_code = 200 if result.get("status") == "ready" else 503
    return JSONResponse(status_code=status_code, content=result)


@app.get("/health/containers")
def health_containers():
    return health_service.containers_health()
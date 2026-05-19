"""Health check endpoints para el LSP Management Service."""

def liveness():
    """Liveness probe — el proceso esta vivo."""
    return {"status": "ok"}

def readiness():
    """Readiness probe — el servicio puede aceptar requests."""
    return {"status": "ready"}

def containers_health():
    """Estado de salud de los contenedores LSP gestionados."""
    return {"status": "ok", "containers": []}

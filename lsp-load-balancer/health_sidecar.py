#!/usr/bin/env python3
"""
Health sidecar para el LSP Load Balancer.

Expone un endpoint HTTP en el puerto 9090 que consulta Redis para determinar
cuántas instancias del Servicio de Lenguaje están vivas. Nginx usa proxy_pass
a este sidecar desde su location = /health, reemplazando el return 200 estático.

Fuente de datos:
    - SMEMBERS lsp:instances  → lista de "<ip>:<port>:<pid>"
    - EXISTS lsp:heartbeat:<id> → filtro de instancias con heartbeat activo (TTL 30s)
"""

import json
import os
import socket
from http.server import HTTPServer, BaseHTTPRequestHandler

import redis

# ── Configuración desde variables de entorno ─────────────────────────────
PORT = int(os.getenv("HEALTH_SIDECAR_PORT", 9090))
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
REDIS_DB = int(os.getenv("REDIS_DB", 0))

_redis = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    db=REDIS_DB,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_timeout=5,
)


def get_live_instances():
    """Retorna lista de instancias LSP vivas desde Redis."""
    try:
        members = _redis.smembers("lsp:instances")
    except redis.RedisError:
        return []

    live = []
    for member in members:
        try:
            ip, port, _ = member.rsplit(":", 2)
        except ValueError:
            continue
        try:
            if _redis.exists(f"lsp:heartbeat:{member}"):
                live.append(f"{ip}:{port}")
        except redis.RedisError:
            continue

    return sorted(live, key=lambda x: int(x.split(":")[1]))


class HealthHandler(BaseHTTPRequestHandler):
    """Manejador HTTP mínimo para el endpoint de health."""

    def do_GET(self):
        if self.path != "/" and self.path != "/health":
            self.send_response(404)
            self.end_headers()
            return

        instances = get_live_instances()
        total = len(instances)
        # total_registered intenta reflejar cuántas debería haber si Redis está sano
        try:
            registered = _redis.scard("lsp:instances")
        except redis.RedisError:
            registered = total

        body = {
            "status": "ok" if total > 0 else "degraded",
            "total_instances": registered,
            "alive_instances": total,
            "instances": instances,
        }

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode("utf-8"))

    def log_message(self, format, *args):
        pass  # Silenciar logs HTTP del stdlib


class ReuseHTTPServer(HTTPServer):
    """Servidor HTTP con SO_REUSEADDR para evitar [Errno 98] en reinicios rápidos."""
    allow_reuse_address = True


def main():
    server = ReuseHTTPServer(("0.0.0.0", PORT), HealthHandler)
    print(f"[health-sidecar:LSP] Escuchando en puerto {PORT}")
    print(f"[health-sidecar:LSP] Redis: {REDIS_HOST}:{REDIS_PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[health-sidecar:LSP] Detenido.")
        server.server_close()


if __name__ == "__main__":
    main()

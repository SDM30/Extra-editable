#!/usr/bin/env python3
"""
Health sidecar para el Collab Load Balancer.

Expone un endpoint HTTP en el puerto 9091 que sondea las instancias collab
(:1234, :1235, :1236) y retorna cuántas están vivas. Nginx usa proxy_pass
a este sidecar desde su location = /health.

Cada instancia collab debe exponer un endpoint GET /health que retorne
{"status": "ok", "port": <puerto>, "active_rooms": <n>}.
"""

import json
import os
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

import requests

# ── Configuración desde variables de entorno ─────────────────────────────
PORT = int(os.getenv("HEALTH_SIDECAR_PORT", 9091))
# Lista de instancias collab a monitorear, separadas por coma
INSTANCES_CSV = os.getenv("COLLAB_INSTANCES", "localhost:1234,localhost:1235,localhost:1236")
COLLAB_INSTANCES = [s.strip() for s in INSTANCES_CSV.split(",") if s.strip()]
TIMEOUT = float(os.getenv("COLLAB_HEALTH_TIMEOUT", 3))
CACHE_TTL = float(os.getenv("CACHE_TTL", 2))  # segundos de caché para no saturar las instancias

# ── Caché en memoria ─────────────────────────────────────────────────────
_cache = {"data": None, "ts": 0.0}


def poll_instances():
    """Sondea cada instancia collab y retorna estado agregado."""
    now = time.time()
    if _cache["data"] is not None and (now - _cache["ts"]) < CACHE_TTL:
        return _cache["data"]

    alive = []
    dead = []
    session = requests.Session()

    for instance in COLLAB_INSTANCES:
        url = f"http://{instance}/health"
        try:
            resp = session.get(url, timeout=TIMEOUT)
            if 200 <= resp.status_code < 300:
                alive.append(instance)
            else:
                dead.append(instance)
        except requests.RequestException:
            dead.append(instance)

    data = {
        "status": "ok" if len(alive) > 0 else "degraded",
        "total_instances": len(COLLAB_INSTANCES),
        "alive_instances": len(alive),
        "dead_instances": len(dead),
        "instances_alive": alive,
        "instances_dead": dead,
    }
    _cache["data"] = data
    _cache["ts"] = now
    return data


class HealthHandler(BaseHTTPRequestHandler):
    """Manejador HTTP mínimo para el endpoint de health."""

    def do_GET(self):
        if self.path != "/" and self.path != "/health":
            self.send_response(404)
            self.end_headers()
            return

        data = poll_instances()

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def log_message(self, format, *args):
        pass  # Silenciar logs HTTP del stdlib


class ReuseHTTPServer(HTTPServer):
    """Servidor HTTP con SO_REUSEADDR para evitar [Errno 98] en reinicios rápidos."""
    allow_reuse_address = True


def main():
    server = ReuseHTTPServer(("0.0.0.0", PORT), HealthHandler)
    print(f"[health-sidecar:Collab] Escuchando en puerto {PORT}")
    print(f"[health-sidecar:Collab] Instancias: {', '.join(COLLAB_INSTANCES)}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[health-sidecar:Collab] Detenido.")
        server.server_close()


if __name__ == "__main__":
    main()

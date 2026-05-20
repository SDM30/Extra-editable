#!/usr/bin/env python3
"""
Agente sidecar de recuperación para instancias de language-service.
Descubre los contenedores LSP locales por label de Docker, no por nombre fijo.
Un solo agente puede vigilar múltiples instancias LSP (útil en dev con --scale).

Responsabilidades:
  1. Watchdog (cada CHECK_SECS s): descubre contenedores LSP por label,
     verifica salud de cada uno vía docker inspect, y hace docker start
     de los que estén parados o unhealthy.
  2. Subscriber Redis Pub/Sub (canal lb:lsp:commands):
     al recibir SPAWN → docker start de todos los contenedores LSP parados.

Variables de entorno:
  LABEL         : label de Docker para filtrar contenedores LSP (default: lsp.service=api)
  REDIS_HOST    : host Redis (default: localhost)
  REDIS_PORT    : puerto Redis (default: 6379)
  CHECK_SECS    : intervalo del watchdog (default: 10)
"""

import subprocess
import time
import threading
import os
import sys

import redis


# ── Configuración ──────────────────────────────────────────────────────────────
LABEL      = os.getenv("LABEL", "lsp.service=api")
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
CHECK_SECS = int(os.getenv("CHECK_SECS", 10))
CHANNEL    = "lb:lsp:commands"

REDIS = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_timeout=5
)


# ── Descubrimiento de contenedores LSP locales ────────────────────────────────

def get_lsp_containers() -> list[str]:
    """
    Retorna los nombres de todos los contenedores LSP (corriendo o parados)
    en este host que tengan el label configurado.
    """
    try:
        r = subprocess.run(
            ["docker", "ps", "-a",
             "--filter", f"label={LABEL}",
             "--format", "{{.Names}}"],
            capture_output=True, text=True, timeout=5
        )
        return [name for name in r.stdout.strip().split("\n") if name]
    except (subprocess.TimeoutExpired, FileNotFoundError, Exception) as e:
        print(f"[agent] error descubriendo contenedores: {e}", file=sys.stderr)
        return []


# ── Liveness ──────────────────────────────────────────────────────────────────

def is_healthy(container: str) -> bool:
    """
    True si el contenedor está corriendo y su health check pasa.
    Lee {{.State.Status}} y {{.State.Health.Status}} vía docker inspect.
    """
    try:
        r = subprocess.run(
            ["docker", "inspect", "-f",
             "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
             container],
            capture_output=True, text=True, timeout=5
        )
        if r.returncode != 0:
            return False
        parts = r.stdout.strip().split(maxsplit=1)
        status = parts[0] if parts else ""
        health = parts[1] if len(parts) > 1 else "none"

        if status != "running":
            return False
        if health in ("healthy", "none", "starting"):
            return True
        return False

    except (subprocess.TimeoutExpired, Exception) as e:
        print(f"[agent] error en inspect de {container}: {e}", file=sys.stderr)
        return False


def start_container(container: str):
    """docker start <container>. Idempotente."""
    print(f"[agent] docker start {container}")
    try:
        subprocess.run(
            ["docker", "start", container],
            capture_output=True, timeout=30
        )
    except Exception as e:
        print(f"[agent] error al iniciar {container}: {e}", file=sys.stderr)


# ── Watchdog ──────────────────────────────────────────────────────────────────

def watchdog_cycle():
    """
    Una iteración del watchdog: descubre contenedores LSP locales y
    arranca los que no estén healthy.
    """
    containers = get_lsp_containers()
    if not containers:
        return  # sin contenedores LSP en este host

    for c in containers:
        try:
            if not is_healthy(c):
                print(f"[agent] {c} no healthy → docker start")
                start_container(c)
        except Exception as e:
            print(f"[agent] error en watchdog para {c}: {e}", file=sys.stderr)


# ── Subscriber Redis ──────────────────────────────────────────────────────────

def subscriber_loop():
    """
    Escucha el canal lb:lsp:commands vía Redis Pub/Sub.
    Al recibir SPAWN, inicia todos los contenedores LSP locales que estén
    parados. Reconecta automáticamente si Redis cae.
    """
    print(f"[agent] subscriber iniciado, canal: {CHANNEL}")
    while True:
        try:
            pubsub = REDIS.pubsub()
            pubsub.subscribe(CHANNEL)
            print(f"[agent] suscrito a {CHANNEL}")

            for msg in pubsub.listen():
                if msg["type"] != "message":
                    continue
                if msg["data"] != "SPAWN":
                    continue

                containers = get_lsp_containers()
                stopped = [c for c in containers if not is_healthy(c)]

                if not stopped:
                    print("[agent] SPAWN ignorado: todos los contenedores LSP ya están healthy")
                    continue

                print(f"[agent] SPAWN recibido → iniciando {len(stopped)} contenedores: {stopped}")
                for c in stopped:
                    start_container(c)

        except redis.RedisError as e:
            print(f"[agent] Redis error: {e} — reintentando en 5s", file=sys.stderr)
            time.sleep(5)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"[agent] iniciando, label: {LABEL}, intervalo: {CHECK_SECS}s")

    sub_thread = threading.Thread(target=subscriber_loop, daemon=True)
    sub_thread.start()

    while True:
        watchdog_cycle()
        time.sleep(CHECK_SECS)

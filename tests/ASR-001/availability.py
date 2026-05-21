#!/usr/bin/env python3
"""
Monitor de disponibilidad extremo-a-extremo con Playwright (capa UI).

Implementa ASR-001 / NF-001 — carga simulada con navegador real.
Ejecuta workers Playwright que simulan usuarios interactuando con la UI:
login, abrir editor, escribir codigo, autocompletado LSP, ejecucion, logout.

Uso:
    python3 availability.py --mode dev --playwright-workers 1 --headed
    python3 availability.py --mode prod --playwright-workers 3 --duration 14400
"""

import argparse
import asyncio
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Dict, List

from dotenv import load_dotenv

from playwright_worker import PlaywrightWorker
from phase2_setup import setup_phase2, teardown_phase2

load_dotenv()

DEFAULT_DURATION = 120
DEFAULT_CYCLE_SEC = 60
DEFAULT_TIMEOUT_SEC = 30
DEFAULT_EDITOR_TIMEOUT_SEC = 45
DEFAULT_WORKERS = 1

# -- URLs segun modo -----------------------------------------------------------

URLS = {
    "dev": {
        "frontend": "http://localhost:4200",
        "backend": "http://localhost:8000",
    },
    "prod": {
        "frontend": "http://10.43.98.3:4200",
        "backend": "http://10.43.98.3:8000",
    },
}


def resolve_urls(mode: str) -> dict:
    """Resuelve URLs segun modo. Env vars sobreescriben los defaults del modo."""
    defaults = URLS.get(mode, URLS["dev"])
    return {
        "frontend": os.getenv("FRONTEND_URL") or defaults["frontend"],
        "backend": os.getenv("BACKEND_URL") or defaults["backend"],
    }


# -- Creacion de proyecto de prueba via API ------------------------------------

def _api_request(method: str, url: str, token: str = None, json_body: dict = None) -> dict:
    import requests

    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = requests.request(method, url, headers=headers, json=json_body or {}, timeout=15)
    return resp.json() if resp.text else {}


def login_via_api(backend_url: str, username: str, password: str) -> str:
    data = _api_request("POST", f"{backend_url}/api/auth/login/",
                        json_body={"username": username, "password": password})
    token = data.get("access")
    if not token:
        raise RuntimeError(f"Login API fallo para {username}: {data}")
    print(f"[setup] Login OK: {username}")
    return token


def ensure_test_project(backend_url: str, token: str, project_name: str, language: str) -> int:
    """Busca o crea el proyecto de prueba con el lenguaje correcto. Retorna project_id."""
    lang_upper = language.upper()
    project_key = f"{project_name}-{language.lower()}"

    # Buscar existente con mismo nombre y lenguaje
    resp = _api_request("GET", f"{backend_url}/api/projects/", token=token)
    for proj in resp.get("results", []):
        if proj.get("nombre") == project_key:
            existing_lang = proj.get("lenguaje", "")
            if existing_lang == lang_upper:
                pid = proj["id"]
                print(f"[setup] Proyecto '{project_key}' ya existe (id={pid}, {lang_upper})")
                return pid
            else:
                # Lenguaje no coincide -- recrear
                print(f"[setup] Proyecto '{project_key}' existe con lenguaje {existing_lang}, recreando como {lang_upper}...")
                _api_request("DELETE", f"{backend_url}/api/projects/{proj['id']}/", token=token)
                break

    # Crear
    data = _api_request("POST", f"{backend_url}/api/projects/",
                        token=token,
                        json_body={"nombre": project_key, "lenguaje": lang_upper,
                                   "descripcion": f"Proyecto de prueba Playwright ({lang_upper})"})
    pid = data.get("id")
    if not pid:
        raise RuntimeError(f"No se pudo crear proyecto '{project_key}': {data}")
    print(f"[setup] Proyecto '{project_key}' creado (id={pid}, {lang_upper})")
    return pid


# -- Worker loop ---------------------------------------------------------------

class WorkerThread(threading.Thread):
    """Ejecuta ciclos Playwright en un hilo separado."""

    def __init__(self, worker: PlaywrightWorker, duration_sec: float, cycle_sec: float):
        super().__init__(daemon=True)
        self.worker = worker
        self.duration_sec = duration_sec
        self.cycle_sec = cycle_sec

    def run(self):
        stop_at = time.time() + self.duration_sec

        async def _loop():
            cycle = 0
            while time.time() < stop_at:
                cycle += 1
                remaining = stop_at - time.time()
                print(f"\n[{self.worker.username}] Ciclo #{cycle} — {remaining:.0f}s restantes")
                await self.worker.run_cycle()
                if remaining > self.cycle_sec:
                    await asyncio.sleep(self.cycle_sec)
                elif remaining > 0:
                    await asyncio.sleep(remaining)

        asyncio.run(_loop())


# -- Reporte ------------------------------------------------------------------

def generate_report(
    workers_stats: List[dict],
    config: dict,
    duration_s: float,
    output_dir: str,
) -> str:
    os.makedirs(output_dir, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = os.path.join(output_dir, f"availability_ui_{ts}.json")

    # Agregado global
    global_total = sum(s["total_cycles"] for s in workers_stats)
    global_success = sum(s["successful_cycles"] for s in workers_stats)
    rate = round((global_success / global_total * 100) if global_total else 0, 2)
    all_screenshots = []
    for s in workers_stats:
        all_screenshots.extend(s.get("screenshots", []))

    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "config": config,
        "summary": {
            "total_cycles": global_total,
            "successful_cycles": global_success,
            "availability_pct": rate,
            "duration_s": duration_s,
            "workers": workers_stats,
            "screenshots": all_screenshots[:50],
        },
    }

    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print(f"\nReporte JSON guardado en: {path}")
    return path


def print_report(workers: list, duration_s: float):
    """Imprime reporte en consola."""
    print("\n" + "=" * 65)
    print("REPORTE DE DISPONIBILIDAD UI (Playwright)")
    print("=" * 65)

    for w in workers:
        snap = w.stats.snapshot()
        print(f"\n  Worker: {w.username}")
        print(f"  Ciclos: {snap['total_cycles']} total, {snap['successful_cycles']} exitosos")
        for step, data in snap["by_step"].items():
            status = "\u2713" if data["success_rate"] >= 90 else "\u2717"
            print(f"    {step:20s} {status} {data['success_rate']:5.1f}%  "
                  f"({data['success']} OK / {data['error']} fail)  avg {data['avg_ms']:.0f}ms")

    # Global
    total = sum(w.stats.total_cycles for w in workers)
    ok = sum(w.stats.successful_cycles for w in workers)
    rate = round((ok / total * 100) if total else 0, 2)
    print(f"\n  Global: {ok}/{total} ciclos exitosos — {rate:.1f}% disponibilidad UI")
    if rate >= 90:
        print("  CUMPLE el requisito de disponibilidad (\u226590%).")
    else:
        print(f"  NO CUMPLE (deficit de {90 - rate:.1f}%).")
    print("-" * 65)


def print_report_phase2(workers: list, worker_configs: list[dict], duration_s: float):
    """Imprime reporte agrupado por proyecto."""
    print("\n" + "=" * 65)
    print("REPORTE FASE 2 — Disponibilidad UI multi-usuario")
    print("=" * 65)

    # Agrupar workers por proyecto
    by_project: Dict[str, list] = {}
    for w, cfg in zip(workers, worker_configs):
        pname = cfg["project_name"]
        if pname not in by_project:
            by_project[pname] = []
        by_project[pname].append(w)

    for pname, proj_workers in by_project.items():
        snapshots = [w.stats.snapshot() for w in proj_workers]
        proj_total = sum(s["total_cycles"] for s in snapshots)
        proj_ok = sum(s["successful_cycles"] for s in snapshots)
        rate = round((proj_ok / proj_total * 100) if proj_total else 0, 2)
        print(f"\n  Proyecto: {pname} ({len(proj_workers)} usuarios)")
        for w in proj_workers:
            snap = w.stats.snapshot()
            print(f"    Worker {w.username}: {snap['successful_cycles']}/{snap['total_cycles']} ciclos OK")
        print(f"    Proyecto: {proj_ok}/{proj_total} — {rate:.1f}%")

    # Global
    total = sum(w.stats.total_cycles for w in workers)
    ok = sum(w.stats.successful_cycles for w in workers)
    rate = round((ok / total * 100) if total else 0, 2)
    print(f"\n  Global: {ok}/{total} ciclos exitosos — {rate:.1f}% disponibilidad UI")
    if rate >= 90:
        print("  CUMPLE el requisito de disponibilidad (>=90%).")
    else:
        print(f"  NO CUMPLE (deficit de {90 - rate:.1f}%).")
    print("-" * 65)


# -- Argumentos ----------------------------------------------------------------

def build_parser():
    parser = argparse.ArgumentParser(
        description="Health polling UI con Playwright — ASR-001 / NF-001"
    )
    parser.add_argument("--mode", choices=["dev", "prod"], default=argparse.SUPPRESS,
                        help="Modo de operacion: dev (localhost) o prod (IPs VM)")
    parser.add_argument("--playwright-workers", type=int, default=argparse.SUPPRESS,
                        help=f"Numero de workers Playwright en paralelo (default: {DEFAULT_WORKERS})")
    parser.add_argument("--duration", type=float, default=argparse.SUPPRESS,
                        help=f"Duracion total en segundos (default: {DEFAULT_DURATION})")
    parser.add_argument("--cycle-sec", "--interval", type=float, default=argparse.SUPPRESS,
                        help=f"Segundos entre ciclos de cada worker (default: {DEFAULT_CYCLE_SEC})")
    parser.add_argument("--headed", action="store_true",
                        help="Ejecutar navegador visible (no headless)")
    parser.add_argument("--headless", action="store_true",
                        help="Ejecutar navegador sin UI (forzar headless)")
    parser.add_argument("--output-dir", default="results",
                        help="Directorio para reportes JSON y screenshots")
    parser.add_argument("--phase2", action="store_true",
                        help="Activar modo multi-usuario Fase 2 (round-robin)")
    parser.add_argument("--users", type=int, default=argparse.SUPPRESS,
                        help="Numero de usuarios simultaneos (requerido con --phase2)")
    return parser


# -- Main ---------------------------------------------------------------------

def main():
    parser = build_parser()
    args = parser.parse_args()

    # Resolver configuracion: CLI > env > defaults
    mode = getattr(args, "mode", None) or os.getenv("MODE", "dev")
    phase2 = getattr(args, "phase2", False)
    phase2_users = int(getattr(args, "users", None) or 0)

    if phase2 and phase2_users < 1:
        print("ERROR: --phase2 requiere --users N (N >= 1)")
        sys.exit(1)

    num_workers = phase2_users if phase2 else int(
        getattr(args, "playwright_workers", None)
        or os.getenv("PLAYWRIGHT_WORKERS", DEFAULT_WORKERS)
    )
    duration = float(getattr(args, "duration", None) or
                     os.getenv("TEST_DURATION", DEFAULT_DURATION))
    cycle_sec = float(getattr(args, "cycle_sec", None) or
                      os.getenv("PLAYWRIGHT_CYCLE_SEC", DEFAULT_CYCLE_SEC))
    timeout_sec = float(os.getenv("PLAYWRIGHT_TIMEOUT_SEC", DEFAULT_TIMEOUT_SEC))
    editor_timeout_sec = float(os.getenv("PLAYWRIGHT_EDITOR_TIMEOUT_SEC", DEFAULT_EDITOR_TIMEOUT_SEC))
    headless = True
    if args.headed:
        headless = False
    elif args.headless:
        headless = True
    else:
        headless = os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() != "false"
    output_dir = args.output_dir or os.getenv("OUTPUT_DIR", "results")
    stagger_ms = int(os.getenv("P2_WORKER_STAGGER_MS", 500))

    urls = resolve_urls(mode)
    password = os.getenv("TEST_PASSWORD", "User1234!")

    print("=" * 65)
    tag = "FASE 2" if phase2 else "HEALTH POLLING UI"
    print(f"{tag} -- Playwright Load Test")
    print("=" * 65)
    print(f"Modo       : {mode}")
    print(f"Frontend   : {urls['frontend']}")
    print(f"Backend    : {urls['backend']}")
    print(f"Workers    : {num_workers}")
    print(f"Duracion   : {duration}s ({duration / 60:.1f} min)")
    print(f"Ciclo cada : {cycle_sec}s")
    print(f"Headless   : {headless}")

    if phase2:
        # -- Fase 2: multi-usuario round-robin ----------------------------------
        try:
            setup_result = setup_phase2(urls["backend"], num_workers, password)
            worker_configs = setup_result["worker_configs"]
            setup_data = setup_result["setup_data"]
        except Exception as exc:
            print(f"ERROR en setup Fase 2: {exc}")
            sys.exit(1)
    else:
        # -- Fase 1: unico usuario ----------------------------------------------
        username = os.getenv("TEST_USERNAME", "simon")
        project_name = os.getenv("TEST_PROJECT_NAME", "test-playwright")
        language = os.getenv("TEST_LANGUAGE", "python")
        project_key = f"{project_name}-{language.lower()}"

        print(f"Usuario    : {username}")
        print(f"Proyecto   : {project_key} ({language})")

        try:
            token = login_via_api(urls["backend"], username, password)
            project_id = ensure_test_project(urls["backend"], token, project_name, language)
        except Exception as exc:
            print(f"ERROR creando proyecto de prueba: {exc}")
            sys.exit(1)

        worker_configs = [{
            "username": username,
            "password": password,
            "project_name": project_key,
            "language": language,
        }] * num_workers

    print("-" * 65)

    # -- Lanzar workers con stagger ---------------------------------------------
    workers: list[PlaywrightWorker] = []
    threads: list[WorkerThread] = []

    for i, cfg in enumerate(worker_configs):
        w = PlaywrightWorker(
            frontend_url=urls["frontend"],
            backend_url=urls["backend"],
            username=cfg["username"],
            password=cfg["password"],
            project_name=cfg["project_name"],
            language=cfg["language"],
            headless=headless,
            timeout_sec=timeout_sec,
            editor_timeout_sec=editor_timeout_sec,
            screenshots_dir=output_dir,
        )
        t = WorkerThread(w, duration, cycle_sec)
        workers.append(w)
        threads.append(t)
        t.start()
        print(f"Worker {i + 1}/{num_workers} iniciado ({cfg['username']} | {cfg['project_name']})")
        if i < len(worker_configs) - 1:
            time.sleep(stagger_ms / 1000)

    # -- Esperar workers --------------------------------------------------------
    for t in threads:
        t.join()

    # -- Reporte ----------------------------------------------------------------
    if phase2:
        print_report_phase2(workers, worker_configs, duration)
    else:
        print_report(workers, duration)

    workers_snapshots = [w.stats.snapshot() for w in workers]

    config = {
        "mode": mode,
        "phase2": phase2,
        "frontend_url": urls["frontend"],
        "backend_url": urls["backend"],
        "workers": num_workers,
        "duration_s": duration,
        "cycle_sec": cycle_sec,
        "headless": headless,
        "worker_configs": worker_configs,
    }
    report_path = generate_report(workers_snapshots, config, duration, output_dir)

    # -- Teardown Fase 2 --------------------------------------------------------
    if phase2:
        try:
            teardown_phase2(urls["backend"], setup_data)
        except Exception as exc:
            print(f"ERROR en teardown Fase 2: {exc}")
            if setup_data.get("usernames"):
                print(f"  Limpiar manualmente usuarios: {', '.join(setup_data['usernames'])}")
            if setup_data.get("project_owner_tokens"):
                proj_names = [e["project"] for e in setup_data["project_owner_tokens"]]
                print(f"  Limpiar manualmente proyectos: {', '.join(proj_names)}")

    # Codigo de salida
    total = sum(w.stats.total_cycles for w in workers)
    ok = sum(w.stats.successful_cycles for w in workers)
    rate = (ok / total * 100) if total else 0
    sys.exit(0 if rate >= 90 else 1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
availability.py — Monitoreo de disponibilidad 2-6 horas con carga simulada (Playwright).
Referencia de despliegue: rama ansible (VMs universitarias).

Topología real (rama ansible):
  david    10.43.98.3     — Backend :8000, Frontend :4200, Gateway :8080, Collab LB :8083
  campos   10.43.99.20    — LSP LB :8085

Funcionalidad:
  1. Health polling (threading): sondeo de todos los servicios cada --interval segundos.
     Targets:
       - Backend login    POST {BACKEND_URL}/api/auth/login/
       - Collab LB real   POST {COLLAB_LB_URL}/dev-token
       - LSP LB health    GET  {LSP_LB_URL}/health  (local nginx — siempre 200 si nginx vive)
       - Gateway health   GET  {GATEWAY_URL}/health  (si existe)

  2. Carga simulada con Playwright (--playwright-workers 2-3 workers en paralelo):
     Ciclo de cada worker cada --playwright-cycle segundos:
       a. Abrir frontend Angular (FRONTEND_URL)
       b. Login vía API (page.request.post o JS eval) → almacenar JWT en localStorage
       c. Navegar al editor de un proyecto de prueba
       d. Esperar .cm-editor  (CodeMirror cargado)
       e. Escribir "pr" en el editor
       f. Ctrl+Space → esperar .cm-tooltip-autocomplete (autocompletado LSP)
       g. Screenshot en caso de fallo
       h. Navegar de vuelta y cerrar sesión

  3. Reporte final combinado (API + UI) → results/availability_YYYYMMDD_HHMMSS.json

Variables de entorno:
  DAVID_IP, CAMPOS_IP
  BACKEND_URL       (default: http://10.43.98.3:8000)
  FRONTEND_URL      (default: http://10.43.98.3:4200)
  LSP_LB_URL        (default: http://10.43.99.20:8085)
  COLLAB_LB_URL     (default: http://10.43.98.3:8083)
  GATEWAY_URL       (default: http://10.43.98.3:8080)
  API_USER, API_PASS
  TEST_PROJECT_ID   (ID numérico de un proyecto existente, default: 1)
  EDITOR_ROUTE      (ruta Angular al editor, default: /editor/{id})
  LOGIN_STORAGE_KEY (clave localStorage para el JWT, default: access_token)
  CM_EDITOR_SEL     (selector CodeMirror, default: .cm-editor)
  AUTOCOMPLETE_SEL  (selector autocompletado, default: .cm-tooltip-autocomplete)

Requisitos:
  pip install httpx playwright
  playwright install chromium

Uso:
  python3 tests/availability.py --duration 4h --interval 30 --playwright-workers 2
  python3 tests/availability.py --duration 2h --interval 30 --playwright-workers 3
  python3 tests/availability.py --duration 6h --interval 30 --no-playwright
  python3 tests/availability.py --duration 0.5h --interval 10 --playwright-workers 1

  # Solo health polling (sin Playwright):
  python3 tests/availability.py --duration 1h --no-playwright

Reporte:
  El reporte JSON se guarda en results/availability_YYYYMMDD_HHMMSS.json.
  Incluye: tasa de disponibilidad por servicio, por paso Playwright, métricas de latencia,
  y un flag global passed/failed (umbral ≥90%).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import threading
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import httpx
except ImportError:
    print("ERROR: httpx no instalado. Ejecuta: pip install httpx", file=sys.stderr)
    sys.exit(1)

# Playwright se importa de forma condicional para que el script funcione
# incluso cuando no está instalado (si se usa --no-playwright).
try:
    from playwright.sync_api import Browser, Page, Playwright, sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

# ── Configuración ───────────────────────────────────────────────────────────────

DAVID_IP  = os.environ.get("DAVID_IP",  "10.43.98.3")
CAMPOS_IP = os.environ.get("CAMPOS_IP", "10.43.99.20")

BACKEND_URL   = os.environ.get("BACKEND_URL",   f"http://{DAVID_IP}:8000")
FRONTEND_URL  = os.environ.get("FRONTEND_URL",  f"http://{DAVID_IP}:4200")
LSP_LB_URL    = os.environ.get("LSP_LB_URL",    f"http://{CAMPOS_IP}:8085")
COLLAB_LB_URL = os.environ.get("COLLAB_LB_URL", f"http://{DAVID_IP}:8083")
GATEWAY_URL   = os.environ.get("GATEWAY_URL",   f"http://{DAVID_IP}:8080")

# Credenciales del usuario de prueba (se crea automáticamente si no existe)
API_USER   = os.environ.get("API_USER",   "probe_availability")
API_PASS   = os.environ.get("API_PASS",   "ProbeTest123!")
API_EMAIL  = os.environ.get("API_EMAIL",  "probe_availability@test.local")
API_NOMBRE = os.environ.get("API_NOMBRE", "Probe Availability")

# Parámetros de Playwright
TEST_PROJECT_ID   = os.environ.get("TEST_PROJECT_ID",   "1")
EDITOR_ROUTE      = os.environ.get("EDITOR_ROUTE",      "/editor/{id}")
LOGIN_STORAGE_KEY = os.environ.get("LOGIN_STORAGE_KEY", "access_token")
CM_EDITOR_SEL     = os.environ.get("CM_EDITOR_SEL",     ".cm-editor")
AUTOCOMPLETE_SEL  = os.environ.get("AUTOCOMPLETE_SEL",  ".cm-tooltip-autocomplete")

AVAILABILITY_THRESHOLD = 90.0  # % mínimo requerido (NF-001)

RESULTS_DIR = Path("results")
SCREENSHOTS_DIR = RESULTS_DIR / "screenshots"
RESULTS_DIR.mkdir(exist_ok=True)
SCREENSHOTS_DIR.mkdir(exist_ok=True)


# ── Estadísticas thread-safe ────────────────────────────────────────────────────

@dataclass
class ServiceStats:
    name: str
    ok: int = 0
    fail: int = 0
    latencies: List[float] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def record(self, ok: bool, latency_ms: float) -> None:
        with self.lock:
            if ok:
                self.ok += 1
            else:
                self.fail += 1
            self.latencies.append(latency_ms)

    @property
    def total(self) -> int:
        return self.ok + self.fail

    @property
    def availability_pct(self) -> float:
        return self.ok / self.total * 100.0 if self.total else 0.0

    @property
    def p50_ms(self) -> float:
        return _percentile(self.latencies, 50)

    @property
    def p95_ms(self) -> float:
        return _percentile(self.latencies, 95)

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "service":           self.name,
                "total":             self.total,
                "ok":                self.ok,
                "fail":              self.fail,
                "availability_pct":  round(self.availability_pct, 2),
                "p50_latency_ms":    round(self.p50_ms, 1),
                "p95_latency_ms":    round(self.p95_ms, 1),
            }


@dataclass
class PlaywrightStepStats:
    """Estadísticas de un paso del ciclo Playwright (login, editor, autocomplete, etc.)."""
    name: str
    ok: int = 0
    fail: int = 0
    latencies: List[float] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def record(self, ok: bool, latency_ms: float) -> None:
        with self.lock:
            if ok:
                self.ok += 1
            else:
                self.fail += 1
            self.latencies.append(latency_ms)

    @property
    def total(self) -> int:
        return self.ok + self.fail

    @property
    def success_rate(self) -> float:
        return self.ok / self.total * 100.0 if self.total else 0.0

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "step":         self.name,
                "total":        self.total,
                "ok":           self.ok,
                "fail":         self.fail,
                "success_rate": round(self.success_rate, 2),
                "p50_ms":       round(_percentile(self.latencies, 50), 1),
            }


def _percentile(values: List[float], pct: float) -> float:
    if not values:
        return 0.0
    sorted_v = sorted(values)
    idx = max(0, min(len(sorted_v) - 1, int(round(pct / 100.0 * (len(sorted_v) - 1)))))
    return sorted_v[idx]


# ── Stats globales (compartidos entre threads) ──────────────────────────────────

HEALTH_STATS: Dict[str, ServiceStats] = {}
PW_STEPS: Dict[str, PlaywrightStepStats] = {}
_STATS_LOCK = threading.Lock()


def get_or_create_service_stats(name: str) -> ServiceStats:
    with _STATS_LOCK:
        if name not in HEALTH_STATS:
            HEALTH_STATS[name] = ServiceStats(name=name)
        return HEALTH_STATS[name]


def get_or_create_step_stats(name: str) -> PlaywrightStepStats:
    with _STATS_LOCK:
        if name not in PW_STEPS:
            PW_STEPS[name] = PlaywrightStepStats(name=name)
        return PW_STEPS[name]


# ── HTTP helpers ────────────────────────────────────────────────────────────────

def _timed_request(method: str, url: str,
                   timeout: float = 5.0, **kwargs) -> Tuple[bool, float, int]:
    """Retorna (ok, latencia_ms, status_code)."""
    start = time.perf_counter()
    try:
        r = httpx.request(method, url, timeout=timeout, **kwargs)
        latency = (time.perf_counter() - start) * 1000
        return 200 <= r.status_code < 300, latency, r.status_code
    except Exception:
        latency = (time.perf_counter() - start) * 1000
        return False, latency, 0


def _try_login() -> Optional[str]:
    try:
        r = httpx.post(
            f"{BACKEND_URL}/api/auth/login/",
            json={"username": API_USER, "password": API_PASS},
            timeout=10,
        )
        if r.status_code == 200:
            return r.json().get("access")
    except Exception:
        pass
    return None


def _try_register() -> bool:
    """Registra el usuario de prueba. Retorna True si tuvo éxito o ya existe."""
    try:
        r = httpx.post(
            f"{BACKEND_URL}/api/auth/register/",
            json={
                "username": API_USER,
                "email":    API_EMAIL,
                "password": API_PASS,
                "nombre":   API_NOMBRE,
            },
            timeout=10,
        )
        if r.status_code == 201:
            print(f"  Usuario de prueba '{API_USER}' registrado.")
            return True
        if r.status_code == 400:
            body = r.text.lower()
            if "already" in body or "exists" in body or "unique" in body:
                print(f"  Usuario de prueba '{API_USER}' ya existe.")
                return True
            print(f"  Register 400: {r.text[:200]}")
    except Exception as exc:
        print(f"  Register error: {exc}")
    return False


def get_jwt_token() -> Optional[str]:
    """Login con usuario de prueba; si no existe, lo registra primero."""
    token = _try_login()
    if token:
        print(f"  Login OK con usuario '{API_USER}'.")
        return token

    print(f"  Login fallido. Registrando usuario '{API_USER}'...")
    if _try_register():
        token = _try_login()
        if token:
            print(f"  Login OK tras registro.")
            return token

    print(f"  ERROR: no se pudo obtener JWT. "
          f"Verifica que el backend ({BACKEND_URL}) esté activo.")
    return None


def get_test_project_id(jwt: str) -> Optional[str]:
    """Intenta obtener el ID del primer proyecto del usuario."""
    if TEST_PROJECT_ID and TEST_PROJECT_ID != "1":
        return TEST_PROJECT_ID
    try:
        r = httpx.get(
            f"{BACKEND_URL}/api/projects/",
            headers={"Authorization": f"Bearer {jwt}"},
            timeout=10,
        )
        if r.status_code == 200:
            projects = r.json()
            if isinstance(projects, list) and projects:
                return str(projects[0].get("id", TEST_PROJECT_ID))
            if isinstance(projects, dict):
                results = projects.get("results", [])
                if results:
                    return str(results[0].get("id", TEST_PROJECT_ID))
    except Exception:
        pass
    return TEST_PROJECT_ID


# ── Health polling thread ────────────────────────────────────────────────────────

def health_poll_worker(
    interval: int,
    stop_event: threading.Event,
    poll_count: threading.Event,
) -> None:
    """Hilo principal de health polling. Sondea todos los servicios cada `interval` segundos."""
    targets = [
        ("backend_login", "POST", f"{BACKEND_URL}/api/auth/login/",
         {"json": {"username": API_USER, "password": API_PASS}}),
        ("collab_lb_real", "POST", f"{COLLAB_LB_URL}/dev-token",
         {"json": {"userId": "availability-check", "username": "availability"}}),
        ("lsp_lb_health", "GET",  f"{LSP_LB_URL}/health", {}),
        ("gateway_health", "GET", f"{GATEWAY_URL}/health", {}),
    ]

    n = 0
    print(f"\n  [polling] Iniciando health polling (intervalo {interval}s)...")
    print(f"  [polling] Targets: {[t[0] for t in targets]}")

    while not stop_event.is_set():
        n += 1
        ts = datetime.now().strftime("%H:%M:%S")
        row_parts = [f"  [{ts}] #{n:4d}"]

        for name, method, url, kwargs in targets:
            stats = get_or_create_service_stats(name)
            ok, lat, status = _timed_request(method, url, timeout=5.0, **kwargs)
            stats.record(ok, lat)
            symbol = "✓" if ok else "✗"
            row_parts.append(f"  {symbol} {name}({lat:.0f}ms)")

        print("".join(row_parts))
        stop_event.wait(timeout=interval)


# ── Playwright worker ────────────────────────────────────────────────────────────

def _step(stats: PlaywrightStepStats, fn, *args, **kwargs):
    """Ejecuta fn, registra ok/fail y latencia en stats."""
    start = time.perf_counter()
    try:
        fn(*args, **kwargs)
        lat = (time.perf_counter() - start) * 1000
        stats.record(True, lat)
        return True
    except Exception:
        lat = (time.perf_counter() - start) * 1000
        stats.record(False, lat)
        return False


def playwright_cycle(
    page: Page,
    worker_id: int,
    cycle_n: int,
    project_id: str,
) -> Dict[str, bool]:
    """Ejecuta un ciclo completo de usuario simulado. Retorna dict paso→éxito."""
    results: Dict[str, bool] = {}
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"  [pw-{worker_id}] [{ts}] Ciclo #{cycle_n} iniciando...")

    # ── Paso 1: Abrir frontend ──────────────────────────────────────────────────
    step_stats = get_or_create_step_stats("1_open_frontend")
    ok = _step(step_stats, lambda: page.goto(FRONTEND_URL, wait_until="domcontentloaded"))
    results["1_open_frontend"] = ok
    if not ok:
        print(f"  [pw-{worker_id}]   1. frontend: FAIL")
        _screenshot(page, worker_id, cycle_n, "01_open_frontend")
        return results
    print(f"  [pw-{worker_id}]   1. frontend: OK")

    # ── Paso 2: Login vía API y almacenar token en localStorage ────────────────
    step_stats = get_or_create_step_stats("2_login")
    try:
        start = time.perf_counter()
        # Obtenemos el token vía la API de Playwright (sin abrir UI de login)
        api_response = page.request.post(
            f"{BACKEND_URL}/api/auth/login/",
            data=json.dumps({"username": API_USER, "password": API_PASS}),
            headers={"Content-Type": "application/json"},
        )
        if api_response.ok:
            body = api_response.json()
            access  = body.get("access", "")
            refresh = body.get("refresh", "")
            if access:
                # Inyectar token en localStorage para que Angular lo recoja
                page.evaluate(
                    f"""() => {{
                        localStorage.setItem('{LOGIN_STORAGE_KEY}', '{access}');
                        localStorage.setItem('refresh_token', '{refresh}');
                    }}"""
                )
                lat = (time.perf_counter() - start) * 1000
                step_stats.record(True, lat)
                results["2_login"] = True
                print(f"  [pw-{worker_id}]   2. login: OK ({lat:.0f}ms)")
            else:
                raise ValueError("access token vacío")
        else:
            raise ValueError(f"HTTP {api_response.status}")
    except Exception as exc:
        lat = (time.perf_counter() - start) * 1000
        step_stats.record(False, lat)
        results["2_login"] = False
        print(f"  [pw-{worker_id}]   2. login: FAIL — {exc}")
        _screenshot(page, worker_id, cycle_n, "02_login")
        return results

    # ── Paso 3: Navegar al editor ───────────────────────────────────────────────
    step_stats = get_or_create_step_stats("3_navigate_editor")
    editor_url = FRONTEND_URL + EDITOR_ROUTE.format(id=project_id)
    try:
        start = time.perf_counter()
        page.goto(editor_url, wait_until="domcontentloaded", timeout=15000)
        lat = (time.perf_counter() - start) * 1000
        step_stats.record(True, lat)
        results["3_navigate_editor"] = True
        print(f"  [pw-{worker_id}]   3. navegación al editor: OK ({lat:.0f}ms) → {editor_url}")
    except Exception as exc:
        lat = (time.perf_counter() - start) * 1000
        step_stats.record(False, lat)
        results["3_navigate_editor"] = False
        print(f"  [pw-{worker_id}]   3. navegación al editor: FAIL — {exc}")
        _screenshot(page, worker_id, cycle_n, "03_navigate_editor")
        return results

    # ── Paso 4: Esperar que CodeMirror cargue ──────────────────────────────────
    step_stats = get_or_create_step_stats("4_editor_loaded")
    try:
        start = time.perf_counter()
        page.wait_for_selector(CM_EDITOR_SEL, timeout=10000)
        lat = (time.perf_counter() - start) * 1000
        step_stats.record(True, lat)
        results["4_editor_loaded"] = True
        print(f"  [pw-{worker_id}]   4. editor CodeMirror: OK ({lat:.0f}ms)")
    except Exception as exc:
        lat = (time.perf_counter() - start) * 1000
        step_stats.record(False, lat)
        results["4_editor_loaded"] = False
        print(f"  [pw-{worker_id}]   4. editor CodeMirror: FAIL — {exc}")
        _screenshot(page, worker_id, cycle_n, "04_editor_loaded")
        # Continuar sin editor (los pasos de autocompletado fallarán también)
        return results

    # ── Paso 5: Escribir código en el editor ───────────────────────────────────
    step_stats = get_or_create_step_stats("5_type_code")
    try:
        start = time.perf_counter()
        editor = page.locator(CM_EDITOR_SEL).first
        editor.click()
        # Mover al final del documento y escribir un prefijo conocido para completado
        page.keyboard.press("End")
        page.keyboard.press("Enter")
        page.keyboard.type("pr", delay=50)
        lat = (time.perf_counter() - start) * 1000
        step_stats.record(True, lat)
        results["5_type_code"] = True
        print(f"  [pw-{worker_id}]   5. escritura código 'pr': OK ({lat:.0f}ms)")
    except Exception as exc:
        lat = (time.perf_counter() - start) * 1000
        step_stats.record(False, lat)
        results["5_type_code"] = False
        print(f"  [pw-{worker_id}]   5. escritura código: FAIL — {exc}")
        _screenshot(page, worker_id, cycle_n, "05_type_code")

    # ── Paso 6: Autocompletado LSP (Ctrl+Space) ─────────────────────────────────
    step_stats = get_or_create_step_stats("6_lsp_autocomplete")
    try:
        start = time.perf_counter()
        # Invocar autocompletado
        page.keyboard.press("Control+Space")
        # Esperar el popup de sugerencias
        page.wait_for_selector(AUTOCOMPLETE_SEL, timeout=8000)
        # Verificar que hay al menos un item
        items = page.query_selector_all(f"{AUTOCOMPLETE_SEL} li")
        if not items:
            # Intentar selector alternativo
            items = page.query_selector_all(f"{AUTOCOMPLETE_SEL} .cm-completionLabel")
        has_items = len(items) > 0
        lat = (time.perf_counter() - start) * 1000
        step_stats.record(has_items, lat)
        results["6_lsp_autocomplete"] = has_items
        if has_items:
            print(f"  [pw-{worker_id}]   6. autocompletado LSP: OK "
                  f"({len(items)} sugerencias, {lat:.0f}ms)")
        else:
            print(f"  [pw-{worker_id}]   6. autocompletado LSP: FAIL (popup sin items)")
            _screenshot(page, worker_id, cycle_n, "06_autocomplete_empty")
    except Exception as exc:
        lat = (time.perf_counter() - start) * 1000
        step_stats.record(False, lat)
        results["6_lsp_autocomplete"] = False
        print(f"  [pw-{worker_id}]   6. autocompletado LSP: FAIL — {exc}")
        _screenshot(page, worker_id, cycle_n, "06_autocomplete_fail")

    # ── Paso 7: Cerrar sesión ──────────────────────────────────────────────────
    step_stats = get_or_create_step_stats("7_logout")
    try:
        start = time.perf_counter()
        page.evaluate(
            f"""() => {{
                localStorage.removeItem('{LOGIN_STORAGE_KEY}');
                localStorage.removeItem('refresh_token');
            }}"""
        )
        lat = (time.perf_counter() - start) * 1000
        step_stats.record(True, lat)
        results["7_logout"] = True
        print(f"  [pw-{worker_id}]   7. logout: OK")
    except Exception as exc:
        step_stats.record(False, 0)
        results["7_logout"] = False
        print(f"  [pw-{worker_id}]   7. logout: FAIL — {exc}")

    cycle_ok = sum(results.values())
    cycle_total = len(results)
    print(f"  [pw-{worker_id}]   Ciclo #{cycle_n}: {cycle_ok}/{cycle_total} pasos OK")
    return results


def _screenshot(page: Page, worker_id: int, cycle_n: int, step: str) -> None:
    try:
        path = SCREENSHOTS_DIR / f"worker{worker_id}_cycle{cycle_n}_{step}.png"
        page.screenshot(path=str(path), full_page=True)
        print(f"  [pw-{worker_id}]   Screenshot: {path}")
    except Exception:
        pass


def playwright_worker_thread(
    worker_id: int,
    cycle_interval: int,
    stop_event: threading.Event,
    project_id: str,
) -> None:
    """Thread que ejecuta ciclos Playwright hasta que stop_event se activa."""
    if not PLAYWRIGHT_AVAILABLE:
        print(f"  [pw-{worker_id}] Playwright no disponible. "
              "Instala con: pip install playwright && playwright install chromium",
              file=sys.stderr)
        return

    cycle_n = 0
    print(f"  [pw-{worker_id}] Worker iniciado (ciclo cada {cycle_interval}s)")

    try:
        with sync_playwright() as p:
            browser: Browser = p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
            )
            context = browser.new_context(
                viewport={"width": 1280, "height": 900},
                ignore_https_errors=True,
            )
            page = context.new_page()
            page.set_default_timeout(12000)

            while not stop_event.is_set():
                cycle_n += 1
                try:
                    playwright_cycle(page, worker_id, cycle_n, project_id)
                except Exception as exc:
                    print(f"  [pw-{worker_id}] Error inesperado en ciclo #{cycle_n}: {exc}")
                    traceback.print_exc()

                # Esperar hasta el siguiente ciclo o hasta que se detenga
                stop_event.wait(timeout=cycle_interval)

            context.close()
            browser.close()
    except Exception as exc:
        print(f"  [pw-{worker_id}] Worker crasheó: {exc}", file=sys.stderr)
        traceback.print_exc()

    print(f"  [pw-{worker_id}] Worker terminado ({cycle_n} ciclos ejecutados)")


# ── Reporte ──────────────────────────────────────────────────────────────────────

def generate_report(
    start_time: datetime,
    end_time: datetime,
    duration_s: float,
    args: argparse.Namespace,
    project_id: str,
) -> dict:
    health_snapshots = {name: stats.snapshot()
                        for name, stats in HEALTH_STATS.items()}
    pw_snapshots = {name: stats.snapshot()
                    for name, stats in PW_STEPS.items()}

    # Disponibilidad global API
    all_ok    = sum(s["ok"]    for s in health_snapshots.values())
    all_total = sum(s["total"] for s in health_snapshots.values())
    api_availability = all_ok / all_total * 100.0 if all_total else 0.0

    # Disponibilidad UI (paso de autocompletado LSP es la métrica más exigente)
    lsp_autocomplete = pw_snapshots.get("6_lsp_autocomplete", {})
    lsp_ui_availability = lsp_autocomplete.get("success_rate", 0.0) if lsp_autocomplete else 0.0

    # Disponibilidad combinada (promedio de API + UI si hay datos de Playwright)
    if pw_snapshots:
        ui_ok    = sum(s["ok"]    for s in pw_snapshots.values())
        ui_total = sum(s["total"] for s in pw_snapshots.values())
        ui_availability = ui_ok / ui_total * 100.0 if ui_total else 0.0
        combined = (api_availability + ui_availability) / 2
    else:
        ui_availability = 0.0
        combined = api_availability

    passed = combined >= AVAILABILITY_THRESHOLD

    return {
        "timestamp_start": start_time.isoformat(),
        "timestamp_end":   end_time.isoformat(),
        "duration_s":      round(duration_s, 1),
        "config": {
            "backend_url":        BACKEND_URL,
            "frontend_url":       FRONTEND_URL,
            "lsp_lb_url":         LSP_LB_URL,
            "collab_lb_url":      COLLAB_LB_URL,
            "gateway_url":        GATEWAY_URL,
            "poll_interval_s":    args.interval,
            "playwright_workers": args.playwright_workers if not args.no_playwright else 0,
            "playwright_cycle_s": args.playwright_cycle,
            "test_project_id":    project_id,
            "editor_route":       EDITOR_ROUTE,
            "cm_editor_selector": CM_EDITOR_SEL,
            "autocomplete_sel":   AUTOCOMPLETE_SEL,
        },
        "health_polling": health_snapshots,
        "playwright_steps": pw_snapshots,
        "summary": {
            "api_availability_pct":      round(api_availability, 2),
            "ui_availability_pct":       round(ui_availability, 2),
            "lsp_autocomplete_pct":      round(lsp_ui_availability, 2),
            "combined_availability_pct": round(combined, 2),
            "threshold_pct":             AVAILABILITY_THRESHOLD,
            "passed":                    passed,
            "verdict": "CUMPLE (≥90%)" if passed else f"NO CUMPLE (déficit {AVAILABILITY_THRESHOLD - combined:.2f}%)",
        },
    }


def print_report(report: dict) -> None:
    s = report["summary"]
    h = report["health_polling"]

    print("\n" + "=" * 70)
    print("REPORTE DE DISPONIBILIDAD")
    print("=" * 70)
    print(f"  Duración          : {report['duration_s']:.0f}s "
          f"({report['duration_s'] / 3600:.2f}h)")
    print(f"  Inicio            : {report['timestamp_start']}")
    print(f"  Fin               : {report['timestamp_end']}")

    print("\n  ── Health Polling ──")
    for name, snap in h.items():
        print(f"  {name:22s}: {snap['availability_pct']:6.2f}%  "
              f"({snap['ok']}/{snap['total']})  "
              f"p50={snap['p50_latency_ms']:.0f}ms  p95={snap['p95_latency_ms']:.0f}ms")

    if report["playwright_steps"]:
        print("\n  ── Playwright (UI) ──")
        for name, snap in sorted(report["playwright_steps"].items()):
            print(f"  {name:28s}: {snap['success_rate']:6.2f}%  "
                  f"({snap['ok']}/{snap['total']})  p50={snap['p50_ms']:.0f}ms")

    print(f"\n  Disponibilidad API             : {s['api_availability_pct']:.2f}%")
    print(f"  Disponibilidad UI (Playwright) : {s['ui_availability_pct']:.2f}%")
    print(f"  Autocompletado LSP (UI)        : {s['lsp_autocomplete_pct']:.2f}%")
    print(f"  Disponibilidad COMBINADA       : {s['combined_availability_pct']:.2f}%")
    print(f"  Umbral requerido               : {s['threshold_pct']:.1f}%")
    print(f"\n  Veredicto: {s['verdict']}")
    print("=" * 70)


# ── CLI ──────────────────────────────────────────────────────────────────────────

def _parse_duration(raw: str) -> float:
    """Parsea '4h', '120m', '3600' como segundos."""
    raw = raw.strip().lower()
    if raw.endswith("h"):
        return float(raw[:-1]) * 3600
    if raw.endswith("m"):
        return float(raw[:-1]) * 60
    return float(raw)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--duration", default="4h",
        help="Duración del monitoreo: '4h', '120m', '7200' (segundos). "
             "Rango recomendado: 2h–6h. (default: 4h)",
    )
    parser.add_argument(
        "--interval", type=int, default=30,
        help="Intervalo de health polling en segundos (default: 30)",
    )
    parser.add_argument(
        "--playwright-workers", type=int, default=2, dest="playwright_workers",
        help="Número de workers Playwright en paralelo (default: 2, máx recomendado: 3)",
    )
    parser.add_argument(
        "--playwright-cycle", type=int, default=60, dest="playwright_cycle",
        help="Segundos entre ciclos por worker Playwright (default: 60)",
    )
    parser.add_argument(
        "--no-playwright", action="store_true", dest="no_playwright",
        help="Deshabilitar Playwright (solo health polling API)",
    )
    parser.add_argument(
        "--project-id", default=TEST_PROJECT_ID, dest="project_id",
        help=f"ID del proyecto de prueba para el editor (default: {TEST_PROJECT_ID})",
    )
    parser.add_argument(
        "--output-json", default="", dest="output_json",
        help="Ruta del reporte JSON (default: results/availability_YYYYMMDD_HHMMSS.json)",
    )
    args = parser.parse_args()

    try:
        duration_s = _parse_duration(args.duration)
    except ValueError:
        print(f"ERROR: duración inválida '{args.duration}'. Usa formato: '4h', '120m' o '3600'",
              file=sys.stderr)
        sys.exit(1)

    if duration_s < 120:
        print("WARN: duración < 2 minutos. Para pruebas reales usa mínimo 2h.")

    use_playwright = not args.no_playwright
    if use_playwright and not PLAYWRIGHT_AVAILABLE:
        print("ERROR: Playwright no instalado. "
              "Usa --no-playwright o instala con: pip install playwright && playwright install chromium",
              file=sys.stderr)
        sys.exit(1)

    print("=" * 70)
    print("MONITOR DE DISPONIBILIDAD — Sistema Colaborativo")
    print("=" * 70)
    print(f"  Duración           : {args.duration} ({duration_s:.0f}s)")
    print(f"  Poll interval      : {args.interval}s")
    print(f"  Playwright workers : {args.playwright_workers if use_playwright else 'deshabilitado'}")
    if use_playwright:
        print(f"  Playwright ciclo   : {args.playwright_cycle}s")
        print(f"  Proyecto prueba    : ID={args.project_id} | Ruta={EDITOR_ROUTE.format(id=args.project_id)}")
        print(f"  Frontend           : {FRONTEND_URL}")
        print(f"  Selectores         : editor='{CM_EDITOR_SEL}' autocomplete='{AUTOCOMPLETE_SEL}'")
    print(f"  Backend            : {BACKEND_URL}")
    print(f"  LSP LB             : {LSP_LB_URL}")
    print(f"  Collab LB          : {COLLAB_LB_URL}")
    print(f"  Screenshots        : {SCREENSHOTS_DIR}/")
    print()

    # Obtener project_id real si es necesario
    project_id = args.project_id
    if use_playwright:
        print("  Obteniendo ID de proyecto de prueba...")
        jwt = get_jwt_token()
        if jwt:
            project_id = get_test_project_id(jwt) or project_id
            print(f"  Proyecto de prueba: ID={project_id}")
        else:
            print("  WARN: no se pudo obtener token JWT para resolver project_id. "
                  f"Usando ID={project_id}")

    stop_event = threading.Event()
    start_time = datetime.now()
    threads: List[threading.Thread] = []

    # Hilo de health polling
    poller = threading.Thread(
        target=health_poll_worker,
        args=(args.interval, stop_event, stop_event),
        daemon=True,
        name="health-poller",
    )
    poller.start()
    threads.append(poller)

    # Workers de Playwright
    if use_playwright:
        for wid in range(1, args.playwright_workers + 1):
            t = threading.Thread(
                target=playwright_worker_thread,
                args=(wid, args.playwright_cycle, stop_event, project_id),
                daemon=True,
                name=f"playwright-worker-{wid}",
            )
            t.start()
            threads.append(t)
            time.sleep(5)  # Escalonar el inicio de workers

    print(f"\n  Monitoreo activo. Duración: {args.duration}. Presiona Ctrl+C para abortar.\n")

    try:
        stop_event.wait(timeout=duration_s)
    except KeyboardInterrupt:
        print("\n\n  Monitoreo interrumpido por el usuario.")
    finally:
        stop_event.set()

    # Dar tiempo a los threads para terminar limpiamente
    for t in threads:
        t.join(timeout=15)

    end_time = datetime.now()
    actual_duration = (end_time - start_time).total_seconds()

    # Generar y mostrar reporte
    report = generate_report(start_time, end_time, actual_duration, args, project_id)
    print_report(report)

    # Guardar JSON
    out_path = args.output_json or str(
        RESULTS_DIR / f"availability_{start_time:%Y%m%d_%H%M%S}.json"
    )
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)
    print(f"\n  Reporte guardado en: {out_path}")
    if SCREENSHOTS_DIR.exists() and any(SCREENSHOTS_DIR.iterdir()):
        print(f"  Screenshots en     : {SCREENSHOTS_DIR}/")

    sys.exit(0 if report["summary"]["passed"] else 1)


if __name__ == "__main__":
    main()

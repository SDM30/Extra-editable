#!/usr/bin/env python3
"""
prueba_real_lsp.py — Prueba realista del balanceador LSP (Nginx :8085)

Combina el monitor de disponibilidad existente con pruebas de stress
contra el balanceador real. Lee la respuesta del header X-LB-Upstream-Addr
para saber exactamente qué réplica atendió cada request.

USO:
    # Prueba completa (disponibilidad + stress + failover)
    python3 prueba_real_lsp.py

    # Solo disponibilidad (20s, sondeo cada 1s)
    python3 prueba_real_lsp.py --mode monitor --duration 20

    # Solo stress (60 workers, 30s)
    python3 prueba_real_lsp.py --mode stress --concurrency 60 --duration 30

    # Stress + matar réplica a los 10s para ver failover
    python3 prueba_real_lsp.py --mode stress --kill-pid 12345 --kill-after 10

REQUISITOS:
    pip3 install requests
"""

import argparse
import datetime
import json
import os
import random
import signal
import subprocess
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

try:
    import requests
except ImportError:
    print(" Ejecuta:  pip3 install requests")
    sys.exit(1)

# ══════════════════════════════════════════════════════════════
#  CONFIGURACIÓN
# ══════════════════════════════════════════════════════════════

LB_BASE      = "http://127.0.0.1:8085"   # Nginx balanceador
LB_HEALTH    = f"{LB_BASE}/health"
LSP_REPLICAS = [                          # APIs FastAPI directas
    "http://127.0.0.1:8001",
    "http://127.0.0.1:8002",
    "http://127.0.0.1:8003",
]
TIMEOUT       = 5.0
UMBRAL_PCT    = 90.0
LANGUAGES     = ["python", "cpp", "typescript"]

# ══════════════════════════════════════════════════════════════
#  MÉTRICAS
# ══════════════════════════════════════════════════════════════

@dataclass
class Req:
    action:     str
    ok:         bool
    status:     int
    latency_ms: float
    upstream:   str
    error:      str = ""

class Stats:
    def __init__(self):
        self._lock     = threading.Lock()
        self.total     = 0
        self.success   = 0
        self.latencies: List[float]         = []
        self.upstream:  Dict[str, int]      = defaultdict(int)
        self.by_action: Dict[str, dict]     = defaultdict(
            lambda: {"total": 0, "ok": 0, "error": 0, "lats": []}
        )
        self.errors:    Dict[str, int]      = defaultdict(int)
        self.timeline:  List[dict]          = []   # para ver evolución temporal

    def add(self, r: Req):
        with self._lock:
            self.total     += 1
            self.latencies.append(r.latency_ms)
            if r.ok:
                self.success += 1
            if r.upstream:
                self.upstream[r.upstream] += 1
            a = self.by_action[r.action]
            a["total"] += 1
            a["lats"].append(r.latency_ms)
            if r.ok:
                a["ok"] += 1
            else:
                a["error"] += 1
                if r.error:
                    self.errors[f"{r.action}:{r.error}"] += 1
            self.timeline.append({
                "t": time.time(), "ok": r.ok,
                "lat": r.latency_ms, "up": r.upstream
            })

    def _pct(self, lats: List[float], p: float) -> float:
        if not lats:
            return 0.0
        s = sorted(lats)
        i = max(0, min(len(s) - 1, int((p / 100) * (len(s) - 1))))
        return s[i]

    def snapshot(self) -> dict:
        with self._lock:
            lats = list(self.latencies)
            ups  = dict(self.upstream)
            acts = {k: dict(v) for k, v in self.by_action.items()}
            errs = dict(self.errors)
            tl   = list(self.timeline)
            tot  = self.total or 1
        return {
            "total":        self.total,
            "success":      self.success,
            "error":        self.total - self.success,
            "success_rate": round(self.success / tot * 100, 2),
            "p50_ms":       round(self._pct(lats, 50), 2),
            "p95_ms":       round(self._pct(lats, 95), 2),
            "p99_ms":       round(self._pct(lats, 99), 2),
            "by_upstream":  ups,
            "by_action":    acts,
            "errors":       errs,
            "timeline":     tl,
        }

# ══════════════════════════════════════════════════════════════
#  HTTP HELPER
# ══════════════════════════════════════════════════════════════

def do_request(
    session: requests.Session,
    method: str,
    url: str,
    action: str,
    **kwargs,
) -> Req:
    t0 = time.perf_counter()
    try:
        resp = session.request(method, url, timeout=TIMEOUT, **kwargs)
        lat  = (time.perf_counter() - t0) * 1000
        # Nginx expone el upstream via header
        upstream = resp.headers.get("X-LB-Upstream-Addr", "")
        if not upstream:
            # Fallback: extraer puerto del ws_url si viene en el body
            try:
                body = resp.json()
                ws_url = body.get("ws_url", "")
                ws_port = body.get("ws_port")
                if ws_url:
                    # ws://127.0.0.1:XXXXX  →  replica:XXXXX
                    port = ws_url.split(":")[-1] if ":" in ws_url else ""
                    upstream = f"replica:{port}" if port else ""
                elif ws_port:
                    upstream = f"replica:{ws_port}"
            except Exception:
                pass
        ok = 200 <= resp.status_code < 300
        return Req(action, ok, resp.status_code, lat, upstream)
    except requests.RequestException as e:
        lat = (time.perf_counter() - t0) * 1000
        return Req(action, False, 0, lat, "", type(e).__name__)

# ══════════════════════════════════════════════════════════════
#  WORKER DE STRESS
# ══════════════════════════════════════════════════════════════

def stress_worker(
    worker_id: int,
    stop_at: float,
    stats: Stats,
    action_delay: float,
):
    session  = requests.Session()
    lang_seq = LANGUAGES.copy()
    random.shuffle(lang_seq)

    while time.time() < stop_at:
        pid      = f"stress-{worker_id}-{random.randint(1, 999_999)}"
        language = random.choice(LANGUAGES)

        # ── 1. Crear contenedor LSP ──────────────────────────
        r = do_request(
            session, "POST",
            f"{LB_BASE}/lsp/{pid}",
            "create_container",
            json={"language": language, "max_clients": 4},
        )
        stats.add(r)

        if not r.ok:
            time.sleep(action_delay)
            continue

        # ── 2. Consultar estado ──────────────────────────────
        r2 = do_request(
            session, "GET",
            f"{LB_BASE}/lsp/{pid}?language={language}",
            "get_status",
        )
        stats.add(r2)

        # ── 3. Health del balanceador (35 % de las veces) ────
        if random.random() < 0.35:
            rh = do_request(session, "GET", LB_HEALTH, "lb_health")
            stats.add(rh)

        # ── 4. Listar contenedores activos (20 % de las veces)
        if random.random() < 0.20:
            rl = do_request(session, "GET", f"{LB_BASE}/lsp/", "list_containers")
            stats.add(rl)

        # ── 5. Eliminar contenedor (60 % de las veces) ───────
        if random.random() < 0.60:
            rd = do_request(
                session, "DELETE",
                f"{LB_BASE}/lsp/{pid}?language={language}",
                "delete_container",
            )
            stats.add(rd)

        if action_delay > 0:
            time.sleep(action_delay)

    session.close()

# ══════════════════════════════════════════════════════════════
#  MONITOR DE DISPONIBILIDAD (usa tu lógica existente)
# ══════════════════════════════════════════════════════════════

def availability_probe(url: str, session: requests.Session) -> Tuple[bool, float, str]:
    t0 = time.perf_counter()
    try:
        resp    = session.get(url, timeout=TIMEOUT)
        lat     = (time.perf_counter() - t0) * 1000
        ok      = resp.status_code == 200
        upstream = resp.headers.get("X-LB-Upstream-Addr", "—")
        return ok, lat, upstream
    except Exception:
        lat = (time.perf_counter() - t0) * 1000
        return False, lat, "—"

def availability_monitor(
    targets: List[Tuple[str, str]],
    interval: float,
    duration: float,
    umbral: float,
) -> dict:
    resultados: Dict[str, List[bool]] = {name: [] for name, _ in targets}
    end_time = time.time() + duration
    n        = 0
    session  = requests.Session()

    print(f"\n{'─'*58}")
    print(f"  MONITOR DE DISPONIBILIDAD")
    print(f"  Intervalo: {interval}s  |  Duración: {duration}s")
    for name, url in targets:
        print(f"  ▸ {name}: {url}")
    print(f"{'─'*58}")

    while time.time() < end_time:
        n += 1
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        row = f"  [{ts}] #{n:>3} "
        for name, url in targets:
            ok, lat, upstream = availability_probe(url, session)
            resultados[name].append(ok)
            sym = "✅" if ok else "❌"
            row += f"  {sym} {name}({lat:.0f}ms)"
        print(row, flush=True)
        time.sleep(interval)

    session.close()

    # ── Reporte ──────────────────────────────────────────────
    print(f"\n{'═'*58}")
    print("  REPORTE DE DISPONIBILIDAD")
    print(f"{'═'*58}")

    global_total = global_ok = 0
    for name, serie in resultados.items():
        total    = len(serie)
        exitosos = sum(serie)
        pct      = exitosos / total * 100 if total else 0
        global_total += total
        global_ok    += exitosos
        status = "✅ CUMPLE" if pct >= umbral else f"❌ NO CUMPLE (déficit {umbral - pct:.1f}%)"
        print(f"  {name:<20} {exitosos}/{total}  {pct:.1f}%  {status}")

    global_pct = global_ok / global_total * 100 if global_total else 0
    gstatus    = "✅ CUMPLE" if global_pct >= umbral else f"❌ NO CUMPLE"
    print(f"{'─'*58}")
    print(f"  GLOBAL               {global_ok}/{global_total}  {global_pct:.1f}%  {gstatus}")
    print(f"  Umbral requerido: {umbral}%")
    print(f"{'═'*58}")

    return resultados

# ══════════════════════════════════════════════════════════════
#  STRESS TEST
# ══════════════════════════════════════════════════════════════

def run_stress(
    concurrency: int,
    duration: float,
    action_delay: float,
    kill_pid: Optional[int],
    kill_after: float,
    output_json: str,
):
    stats   = Stats()
    stop_at = time.time() + duration

    print(f"\n{'═'*58}")
    print(f"  STRESS TEST — Nginx :8085 → réplicas :8001/:8002/:8003")
    print(f"{'═'*58}")
    print(f"  Workers      : {concurrency}")
    print(f"  Duración     : {duration}s")
    print(f"  Delay/acción : {action_delay}s")
    print(f"  Lenguajes    : {', '.join(LANGUAGES)}")
    if kill_pid:
        print(f"  💀 Kill PID  : {kill_pid} en t+{kill_after}s")
    print(f"{'─'*58}\n")

    # ── Failover: matar una réplica a mitad del stress ───────
    if kill_pid:
        def _killer():
            time.sleep(kill_after)
            print(f"\n  💀 [t+{kill_after}s] Matando PID {kill_pid} (simulando caída de réplica)...")
            try:
                os.kill(kill_pid, signal.SIGTERM)
                print(f"  💀  PID {kill_pid} terminado.")
            except ProcessLookupError:
                print(f"  ⚠️  PID {kill_pid} ya no existe.")
        threading.Thread(target=_killer, daemon=True).start()

    # ── Lanzar workers ────────────────────────────────────────
    bar_stop = threading.Event()
    def _progress():
        start = time.time()
        while not bar_stop.is_set():
            elapsed = time.time() - start
            pct     = min(elapsed / duration, 1.0)
            filled  = int(pct * 40)
            bar     = "█" * filled + "░" * (40 - filled)
            snap    = stats.snapshot()
            sys.stdout.write(
                f"\r  [{bar}] {elapsed:.0f}/{duration:.0f}s  "
                f"req={snap['total']} ok={snap['success_rate']:.1f}%  "
                f"p95={snap['p95_ms']:.0f}ms"
            )
            sys.stdout.flush()
            time.sleep(0.5)
        print()
    threading.Thread(target=_progress, daemon=True).start()

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futs = [
            pool.submit(stress_worker, wid, stop_at, stats, action_delay)
            for wid in range(concurrency)
        ]
        for f in as_completed(futs):
            try:
                f.result()
            except Exception:
                pass

    bar_stop.set()
    time.sleep(0.6)

    # ── Reporte de stress ─────────────────────────────────────
    snap = stats.snapshot()
    print(f"\n{'═'*58}")
    print("  REPORTE DE STRESS")
    print(f"{'═'*58}")
    print(f"  Total requests : {snap['total']}")
    print(f"  Exitosos       : {snap['success']}")
    print(f"  Fallidos       : {snap['error']}")
    print(f"  Success rate   : {snap['success_rate']}%")
    print(f"  P50 latency    : {snap['p50_ms']} ms")
    print(f"  P95 latency    : {snap['p95_ms']} ms")
    print(f"  P99 latency    : {snap['p99_ms']} ms")

    print(f"\n  Distribución por réplica (X-LB-Upstream-Addr):")
    if snap["by_upstream"]:
        total_up = sum(snap["by_upstream"].values())
        for up, cnt in sorted(snap["by_upstream"].items(), key=lambda x: -x[1]):
            pct = cnt / total_up * 100
            bar = "█" * int(pct / 2)
            print(f"    {up:<26} {bar:<50} {cnt} ({pct:.1f}%)")
    else:
        print("    Sin datos de upstream. ¿Está corriendo Nginx en :8085?")

    print(f"\n  Por acción:")
    for action, data in sorted(snap["by_action"].items()):
        lats = data.get("lats", [])
        avg  = sum(lats) / len(lats) if lats else 0
        print(
            f"    {action:<22} total={data['total']:<6} "
            f"ok={data['ok']:<6} err={data['error']:<4} avg={avg:.0f}ms"
        )

    if snap["errors"]:
        print(f"\n  Top errores:")
        for key, qty in sorted(snap["errors"].items(), key=lambda x: -x[1])[:8]:
            print(f"    {key} → {qty}")

    # ── Análisis de distribución ──────────────────────────────
    if snap["by_upstream"] and len(snap["by_upstream"]) > 1:
        counts = list(snap["by_upstream"].values())
        total  = sum(counts)
        ideal  = total / len(counts)
        max_dev = max(abs(c - ideal) / ideal * 100 for c in counts)
        print(f"\n  Balanceo:")
        print(f"    Réplicas activas : {len(counts)}")
        print(f"    Desviación máx   : {max_dev:.1f}% del ideal")
        if max_dev < 20:
            print("    Distribución     : ✅ Balanceada")
        elif max_dev < 40:
            print("    Distribución     : ⚠️  Moderada")
        else:
            print("    Distribución     : ❌ Desbalanceada")

    # ── JSON output ───────────────────────────────────────────
    if output_json:
        report = {
            "timestamp": datetime.datetime.now().isoformat(),
            "config": {
                "lb_base": LB_BASE,
                "concurrency": concurrency,
                "duration": duration,
                "action_delay": action_delay,
            },
            "summary": {k: v for k, v in snap.items() if k != "timeline"},
        }
        with open(output_json, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\n  📄 Reporte JSON: {output_json}")

    print(f"{'═'*58}\n")

# ══════════════════════════════════════════════════════════════
#  PRUEBA COMPLETA
# ══════════════════════════════════════════════════════════════

def run_full(args):
    """Disponibilidad en paralelo con el stress, luego reporte combinado."""
    print(f"\n{'═'*58}")
    print("  PRUEBA REALISTA COMPLETA")
    print(f"  {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'═'*58}")

    # Primero verificar que el balanceador está vivo
    try:
        r = requests.get(LB_HEALTH, timeout=TIMEOUT)
        if r.status_code == 200:
            print(f"  ✅ Balanceador en {LB_HEALTH} → OK")
        else:
            print(f"  ⚠️  Balanceador respondió HTTP {r.status_code}")
    except Exception as e:
        print(f"  ❌ No se puede alcanzar {LB_HEALTH}: {e}")
        print("     ¿Corriste: nginx -c $(pwd)/nginx.conf ?")
        sys.exit(1)

    # Verificar réplicas directamente
    print(f"\n  Estado de réplicas:")
    for replica in LSP_REPLICAS:
        try:
            r = requests.get(f"{replica}/health", timeout=2)
            sym = "✅" if r.status_code == 200 else "⚠️ "
            print(f"    {sym} {replica} → HTTP {r.status_code}")
        except Exception:
            print(f"    ❌ {replica} → sin respuesta")

    print()

    # Monitor en background durante el stress
    monitor_results = {}
    monitor_done    = threading.Event()

    monitor_targets = [
        ("balanceador", LB_HEALTH),
    ] + [(f"replica-{i+1}", f"{r}/health") for i, r in enumerate(LSP_REPLICAS)]

    def _monitor_thread():
        monitor_results.update(
            availability_monitor(
                monitor_targets,
                interval=args.interval,
                duration=args.duration + 5,
                umbral=args.umbral,
            )
        )
        monitor_done.set()

    mon_thread = threading.Thread(target=_monitor_thread, daemon=True)
    mon_thread.start()

    time.sleep(1)  # dejar que el monitor arranque

    # Stress
    run_stress(
        concurrency=args.concurrency,
        duration=args.duration,
        action_delay=args.action_delay,
        kill_pid=args.kill_pid,
        kill_after=args.kill_after,
        output_json=args.output_json,
    )

    monitor_done.wait(timeout=15)

# ══════════════════════════════════════════════════════════════
#  CLI
# ══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Prueba realista del balanceador LSP (Nginx :8085)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python3 prueba_real_lsp.py                              # Prueba completa
  python3 prueba_real_lsp.py --mode monitor --duration 30
  python3 prueba_real_lsp.py --mode stress --concurrency 40 --duration 20
  python3 prueba_real_lsp.py --mode stress --kill-pid 73590 --kill-after 10
        """,
    )
    parser.add_argument(
        "--mode",
        choices=["full", "monitor", "stress"],
        default="full",
        help="Modo de ejecución (default: full)",
    )
    parser.add_argument("--concurrency",  type=int,   default=30,   help="Workers paralelos (default: 30)")
    parser.add_argument("--duration",     type=float, default=40,   help="Segundos de prueba (default: 40)")
    parser.add_argument("--interval",     type=float, default=2.0,  help="Intervalo sondeo monitor en s (default: 2)")
    parser.add_argument("--umbral",       type=float, default=90.0, help="Umbral disponibilidad %% (default: 90)")
    parser.add_argument("--action-delay", type=float, default=0.05, help="Pausa entre acciones por worker (default: 0.05)")
    parser.add_argument("--kill-pid",     type=int,   default=None, help="PID de réplica a matar para simular failover")
    parser.add_argument("--kill-after",   type=float, default=15,   help="Segundos antes de matar réplica (default: 15)")
    parser.add_argument("--output-json",  default="stress-report.json", help="Archivo de reporte JSON")
    args = parser.parse_args()

    if args.mode == "monitor":
        targets = [("balanceador", LB_HEALTH)] + [
            (f"replica-{i+1}", f"{r}/health") for i, r in enumerate(LSP_REPLICAS)
        ]
        availability_monitor(targets, args.interval, args.duration, args.umbral)

    elif args.mode == "stress":
        # Precheck
        try:
            r = requests.get(LB_HEALTH, timeout=TIMEOUT)
            print(f"✅ Balanceador OK (HTTP {r.status_code})")
        except Exception as e:
            print(f"❌ Balanceador no responde: {e}")
            sys.exit(1)
        run_stress(
            args.concurrency, args.duration, args.action_delay,
            args.kill_pid, args.kill_after, args.output_json,
        )

    else:
        run_full(args)


if __name__ == "__main__":
    main()
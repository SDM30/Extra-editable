#!/usr/bin/env python3
"""
Health polling de los balanceadores de carga (Collab + LSP).

Sondea los endpoints /health de cada LB cada N segundos durante una ventana
de 2-6 horas, registrando éxitos, fallos y latencia. Al finalizar genera un
reporte en consola y un archivo JSON con las métricas de disponibilidad.

Uso:
    python3 health_poll.py --duration 14400 --interval 30 --mode prod
    python3 health_poll.py --duration 120 --interval 10

Referencia: ASR-001 / NF-001 — Plan de Pruebas v3.0 §2.1
"""

import argparse
import datetime
import json
import os
import sys
import threading
import time
from typing import Dict, List
from urllib.parse import urlparse
from dotenv import load_dotenv
import requests


TIMEOUT = 5
DEFAULT_DURATION = 14400
DEFAULT_INTERVAL = 30
DEFAULT_THRESHOLD = 90.0


def _resolve_endpoints(mode: str) -> Dict[str, str]:
    """Resuelve los endpoints de health según modo (dev/prod) y variables de entorno."""
    if mode == "prod":
        defaults = {
            "collab_lb": "http://10.43.98.3:8083/health",
            "lsp_lb": "http://10.43.99.20:8085/health",
        }
    else:
        defaults = {
            "collab_lb": "http://localhost:8083/health",
            "lsp_lb": "http://localhost:8085/health",
        }
    return {
        "collab_lb": os.getenv("HEALTH_COLLAB_LB", defaults["collab_lb"]),
        "lsp_lb": os.getenv("HEALTH_LSP_LB", defaults["lsp_lb"]),
    }


def percentile(values: List[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = max(0, min(len(ordered) - 1, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return ordered[idx]


class StatsCollector:
    """Acumulador thread-safe de métricas de health polling."""

    def __init__(self):
        self.lock = threading.Lock()
        self.by_service: Dict[str, dict] = {}
        self.errors: Dict[str, int] = {}
        self.latencies: List[float] = []
        self.total = 0
        self.success = 0

    def add(self, service: str, ok: bool, status: int, latency_ms: float, error: str = ""):
        with self.lock:
            self.total += 1
            self.latencies.append(latency_ms)
            if ok:
                self.success += 1

            entry = self.by_service.setdefault(
                service,
                {"total": 0, "ok": 0, "error": 0, "latency_sum": 0.0},
            )
            entry["total"] += 1
            entry["latency_sum"] += latency_ms
            if ok:
                entry["ok"] += 1
            else:
                entry["error"] += 1

            if error:
                key = f"{service}:{error}"
                self.errors[key] = self.errors.get(key, 0) + 1

    def snapshot(self) -> dict:
        with self.lock:
            services = {}
            for name, data in self.by_service.items():
                avg = (data["latency_sum"] / data["total"]) if data["total"] else 0.0
                rate = (data["ok"] / data["total"] * 100) if data["total"] else 0.0
                services[name] = {
                    "total": int(data["total"]),
                    "success": int(data["ok"]),
                    "error": int(data["error"]),
                    "success_rate": round(rate, 2),
                    "avg_ms": round(avg, 2),
                }
            return {
                "total": self.total,
                "success": self.success,
                "error": self.total - self.success,
                "success_rate": round((self.success / self.total * 100.0) if self.total else 0.0, 2),
                "p50_ms": round(percentile(self.latencies, 50), 2),
                "p95_ms": round(percentile(self.latencies, 95), 2),
                "p99_ms": round(percentile(self.latencies, 99), 2),
                "by_service": services,
                "errors": dict(self.errors),
            }


def probe(session: requests.Session, url: str, service: str, timeout: float) -> dict:
    """Ejecuta un GET al endpoint de health y retorna métricas."""
    start = time.perf_counter()
    try:
        resp = session.get(url, timeout=timeout)
        latency_ms = (time.perf_counter() - start) * 1000.0
        ok = 200 <= resp.status_code < 300
        body = ""
        try:
            body = resp.text[:200]
        except Exception:
            pass
        return {
            "ok": ok,
            "status": resp.status_code,
            "latency_ms": latency_ms,
            "error": "" if ok else f"HTTP {resp.status_code}",
            "body": body,
        }
    except requests.RequestException as ex:
        latency_ms = (time.perf_counter() - start) * 1000.0
        return {
            "ok": False,
            "status": 0,
            "latency_ms": latency_ms,
            "error": type(ex).__name__,
            "body": "",
        }


def print_header(endpoints: dict, duration: float, interval: float, threshold: float):
    print("\n" + "=" * 65)
    print("HEALTH POLLING — Monitor de disponibilidad")
    print("=" * 65)
    print(f"Inicio    : {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Duración  : {duration}s ({duration / 3600:.1f}h)")
    print(f"Intervalo : {interval}s")
    print(f"Umbral    : {threshold}%")
    print(f"Servicios : {len(endpoints)}")
    for name, url in endpoints.items():
        print(f"  - {name}: {url}")
    print("-" * 65)


def print_report(snapshot: dict, threshold: float) -> bool:
    print("\n" + "=" * 65)
    print("REPORTE DE DISPONIBILIDAD")
    print("=" * 65)

    for name, data in snapshot["by_service"].items():
        print(f"\n  Servicio       : {name}")
        print(f"  Sondeos totales: {data['total']}")
        print(f"  Exitosos       : {data['success']}")
        print(f"  Fallidos       : {data['error']}")
        print(f"  Disponibilidad : {data['success_rate']:.2f}%")
        print(f"  Latencia media : {data['avg_ms']:.2f}ms")
        if data["success_rate"] >= threshold:
            print("  Estado          : CUMPLE")
        else:
            print(f"  Estado          : NO CUMPLE (déficit de {threshold - data['success_rate']:.2f}%)")
        print("-" * 65)

    print(f"\n  Sondeos globales : {snapshot['total']}")
    print(f"  Exitosos global  : {snapshot['success']}")
    print(f"  Fallidos global  : {snapshot['error']}")
    print(f"  Disponibilidad   : {snapshot['success_rate']:.2f}%")
    print(f"  P50 latencia     : {snapshot['p50_ms']:.2f}ms")
    print(f"  P95 latencia     : {snapshot['p95_ms']:.2f}ms")
    print(f"  P99 latencia     : {snapshot['p99_ms']:.2f}ms")
    print(f"  Umbral requerido : {threshold:.1f}%")
    print("-" * 65)

    if snapshot["success_rate"] >= threshold:
        print("CUMPLE el requisito de disponibilidad.")
        return True
    else:
        print(f"NO CUMPLE (déficit de {threshold - snapshot['success_rate']:.2f}%).")
        return False


def save_json(snapshot: dict, endpoints: dict, duration: float, interval: float,
              threshold: float, output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(output_dir, f"availability_{ts}.json")
    payload = {
        "timestamp": datetime.datetime.now().isoformat(),
        "config": {
            "duration_s": duration,
            "interval_s": interval,
            "threshold_pct": threshold,
            "endpoints": endpoints,
        },
        "summary": snapshot,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"\nReporte JSON guardado en: {path}")


def build_parser():
    parser = argparse.ArgumentParser(
        description="Health polling de disponibilidad para Collab LB y LSP LB"
    )
    parser.add_argument("--duration", type=float, default=argparse.SUPPRESS,
                        help=f"Duración total en segundos (default: {DEFAULT_DURATION})")
    parser.add_argument("--interval", type=float, default=argparse.SUPPRESS,
                        help=f"Intervalo entre sondeos en segundos (default: {DEFAULT_INTERVAL})")
    parser.add_argument("--mode", choices=["dev", "prod"], default=argparse.SUPPRESS,
                        help="Modo de operación: dev (localhost) o prod (IPs VM)")
    parser.add_argument("--threshold", type=float, default=argparse.SUPPRESS,
                        help=f"Umbral mínimo de disponibilidad %% (default: {DEFAULT_THRESHOLD})")
    parser.add_argument("--output-dir", default=argparse.SUPPRESS,
                        help="Directorio para reportes JSON")
    parser.add_argument("--timeout", type=float, default=TIMEOUT,
                        help=f"Timeout por request en segundos (default: {TIMEOUT})")
    return parser


def main():
    load_dotenv()

    parser = build_parser()
    args = parser.parse_args()

    # Resolver endpoints según modo: CLI > env > default
    mode = getattr(args, "mode", None) or os.getenv("MODE", "dev")
    endpoints = _resolve_endpoints(mode)

    # CLI args tienen prioridad; env vars como fallback; defaults como último recurso
    duration = float(getattr(args, "duration", None) or os.getenv("POLL_DURATION", DEFAULT_DURATION))
    interval = float(getattr(args, "interval", None) or os.getenv("POLL_INTERVAL", DEFAULT_INTERVAL))
    threshold = float(getattr(args, "threshold", None) or os.getenv("AVAILABILITY_THRESHOLD", DEFAULT_THRESHOLD))
    output_dir = getattr(args, "output_dir", None) or os.getenv("OUTPUT_DIR", "results")

    print_header(endpoints, duration, interval, threshold)

    stats = StatsCollector()
    session = requests.Session()
    stop_at = time.time() + duration
    poll_num = 0

    while time.time() < stop_at:
        poll_num += 1
        ts = datetime.datetime.now().strftime("%H:%M:%S")

        for service, url in endpoints.items():
            result = probe(session, url, service, args.timeout)
            stats.add(service, result["ok"], result["status"], result["latency_ms"], result["error"])

            marker = "OK" if result["ok"] else "FALLO"
            extra = ""
            if not result["ok"] and result["body"]:
                extra = f" | {result['body'][:80]}"
            print(f"  [{ts}] #{poll_num:04d} [{service:>10}] {marker:>5}  {result['latency_ms']:7.2f}ms{extra}")

        remaining = stop_at - time.time()
        if remaining > interval:
            time.sleep(interval)
        elif remaining > 0:
            time.sleep(remaining)

    snapshot = stats.snapshot()
    passed = print_report(snapshot, threshold)
    save_json(snapshot, endpoints, duration, interval, threshold, output_dir)

    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()

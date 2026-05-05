import argparse
import datetime
import json
import random
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests

DEFAULT_URL = "http://localhost:8080/api/health"
DEFAULT_INTERVAL = 1
DEFAULT_DURATION = 20
TIMEOUT = 3
UMBRAL_MINIMO = 90.0

DEFAULT_GATEWAY_BASE = "http://localhost:8080"
DEFAULT_LB_HEALTH = "http://localhost:8085/health"
DEFAULT_CONCURRENCY = 120
DEFAULT_ACTION_DELAY = 0.05


def parse_target(raw: str):
    if "=" not in raw:
        return raw, raw

    name, url = raw.split("=", 1)
    return name.strip() or url.strip(), url.strip()


def parse_languages(raw: str) -> List[str]:
    items = [item.strip() for item in raw.split(",") if item.strip()]
    return items if items else ["python"]


def percentile(values: List[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = max(0, min(len(ordered) - 1, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return ordered[idx]


@dataclass
class ActionResult:
    action: str
    ok: bool
    status: int
    latency_ms: float
    upstream: str
    error: str = ""


class StatsCollector:
    def __init__(self):
        self.lock = threading.Lock()
        self.by_action: Dict[str, Dict[str, float]] = {}
        self.by_upstream: Dict[str, int] = {}
        self.errors: Dict[str, int] = {}
        self.latencies: List[float] = []
        self.total = 0
        self.success = 0

    def add(self, result: ActionResult):
        with self.lock:
            self.total += 1
            self.latencies.append(result.latency_ms)
            if result.ok:
                self.success += 1

            action = self.by_action.setdefault(
                result.action,
                {"total": 0, "ok": 0, "error": 0, "latency_sum": 0.0},
            )
            action["total"] += 1
            action["latency_sum"] += result.latency_ms
            if result.ok:
                action["ok"] += 1
            else:
                action["error"] += 1

            if result.upstream:
                self.by_upstream[result.upstream] = self.by_upstream.get(result.upstream, 0) + 1

            if result.error:
                key = f"{result.action}:{result.error}"
                self.errors[key] = self.errors.get(key, 0) + 1

    def snapshot(self):
        with self.lock:
            return {
                "total": self.total,
                "success": self.success,
                "error": self.total - self.success,
                "success_rate": (self.success / self.total * 100.0) if self.total else 0.0,
                "p50_ms": percentile(self.latencies, 50),
                "p95_ms": percentile(self.latencies, 95),
                "p99_ms": percentile(self.latencies, 99),
                "by_action": self.by_action,
                "by_upstream": self.by_upstream,
                "errors": self.errors,
            }


def request_with_metrics(
    session: requests.Session,
    method: str,
    url: str,
    action: str,
    timeout: float,
    **kwargs,
) -> ActionResult:
    start = time.perf_counter()
    try:
        response = session.request(method=method, url=url, timeout=timeout, **kwargs)
        latency_ms = (time.perf_counter() - start) * 1000.0
        upstream = response.headers.get("X-LB-Upstream-Addr", "")
        if not upstream:
            try:
                payload = response.json()
                ws_url = payload.get("ws_url") if isinstance(payload, dict) else None
                ws_port = payload.get("ws_port") if isinstance(payload, dict) else None
                if isinstance(ws_url, str) and ws_url:
                    parsed = urlparse(ws_url)
                    if parsed.netloc:
                        upstream = parsed.netloc
                elif ws_port:
                    upstream = f"replica:{ws_port}"
            except ValueError:
                # No todas las respuestas son JSON; en ese caso solo usamos headers.
                pass
        ok = 200 <= response.status_code < 300
        return ActionResult(action, ok, response.status_code, latency_ms, upstream)
    except requests.RequestException as ex:
        latency_ms = (time.perf_counter() - start) * 1000.0
        return ActionResult(action, False, 0, latency_ms, "", str(type(ex).__name__))


def stress_worker(
    worker_id: int,
    gateway_base: str,
    lb_health_url: str,
    languages: List[str],
    max_clients: int,
    timeout: float,
    action_delay: float,
    stop_at: float,
    stats: StatsCollector,
):
    session = requests.Session()

    while time.time() < stop_at:
        project_id = f"stress-{worker_id}-{random.randint(1, 10_000_000)}"
        language = random.choice(languages)

        create_url = f"{gateway_base}/lsp/{project_id}"
        payload = {"language": language, "max_clients": max_clients}
        create = request_with_metrics(
            session,
            "POST",
            create_url,
            "create_container",
            timeout,
            json=payload,
        )
        stats.add(create)

        status_url = f"{gateway_base}/lsp/{project_id}?language={language}"
        status = request_with_metrics(session, "GET", status_url, "container_status", timeout)
        stats.add(status)

        if random.random() < 0.35:
            lb_health = request_with_metrics(
                session,
                "GET",
                lb_health_url,
                "lb_health",
                timeout,
            )
            stats.add(lb_health)

        if random.random() < 0.60:
            destroy = request_with_metrics(session, "DELETE", status_url, "destroy_container", timeout)
            stats.add(destroy)

        if action_delay > 0:
            time.sleep(action_delay)


def availability_probe(url: str) -> bool:
    try:
        resp = requests.get(url, timeout=TIMEOUT)
        return resp.status_code == 200
    except requests.RequestException:
        return False


def availability_monitor(targets, interval, duration):
    resultados = {name: [] for name, _ in targets}
    end_time = time.time() + duration
    n = 0

    print(f"\n[Inicio] {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Intervalo: {interval}s  |  Duración: {duration}s")
    for name, url in targets:
        print(f"- {name}: {url}")
    print("-" * 55)

    while time.time() < end_time:
        n += 1
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        for name, url in targets:
            ok = availability_probe(url)
            print(f"  [{ts}] Sondeo #{n:>3} [{name}]: {'OK' if ok else 'FALLO'}")
            resultados[name].append(ok)
        time.sleep(interval)

    return resultados


def availability_report(resultados, umbral):
    print("\n" + "=" * 55)
    print("REPORTE DE DISPONIBILIDAD")
    print("=" * 55)

    global_total = 0
    global_exitosos = 0

    for nombre, serie in resultados.items():
        total = len(serie)
        exitosos = sum(serie)
        pct = (exitosos / total * 100) if total else 0
        global_total += total
        global_exitosos += exitosos

        print(f"  Target          : {nombre}")
        print(f"  Sondeos totales : {total}")
        print(f"  Exitosos        : {exitosos}")
        print(f"  Fallidos        : {total - exitosos}")
        print(f"  Disponibilidad  : {pct:.2f} %")
        print(f"  Umbral requerido: {umbral:.1f} %")
        if pct >= umbral:
            print("  Estado          : CUMPLE")
        else:
            print(f"  Estado          : NO CUMPLE (déficit de {umbral - pct:.2f} %)")
        print("-" * 55)

    global_pct = (global_exitosos / global_total * 100) if global_total else 0

    print(f"  Sondeos globales : {global_total}")
    print(f"  Exitosos global  : {global_exitosos}")
    print(f"  Fallidos global  : {global_total - global_exitosos}")
    print(f"  Disponibilidad   : {global_pct:.2f} %")
    print(f"  Umbral requerido : {umbral:.1f} %")
    print("-" * 55)
    if global_pct >= umbral:
        print("Cumple el requisito de disponibilidad")
    else:
        print(f"NO cumple (déficit de {umbral - global_pct:.2f} %)")
    print("=" * 55)


def schedule_replica_stop(container_name: str, kill_after: float, restart_after: float):
    def worker():
        time.sleep(kill_after)
        print(f"\n[FAILOVER] Deteniendo réplica {container_name} en t+{kill_after}s")
        subprocess.run(["docker", "stop", container_name], check=False)
        if restart_after > 0:
            time.sleep(restart_after)
            print(
                f"\n[FAILOVER] Iniciando réplica {container_name} "
                f"en t+{kill_after + restart_after}s"
            )
            subprocess.run(["docker", "start", container_name], check=False)

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()


def run_stress(args):
    random.seed(args.seed)
    stats = StatsCollector()
    stop_at = time.time() + args.duration
    languages = parse_languages(args.languages)

    print("\n" + "=" * 65)
    print("STRESS TEST LSP + FAILOVER")
    print("=" * 65)
    print(f"Gateway base       : {args.gateway_base}")
    print(f"Concurrencia       : {args.concurrency}")
    print(f"Duración           : {args.duration}s")
    print(f"Lenguajes          : {', '.join(languages)}")
    print(f"max_clients payload: {args.max_clients}")
    print(f"Timeout request    : {args.timeout}s")
    print("Acciones por iteración: POST /lsp/{project}, GET status, DELETE (probabilístico), health")

    if args.kill_container:
        print(
            f"Fallo inducido      : docker stop {args.kill_container} "
            f"en t+{args.kill_after}s"
        )
        if args.restart_after > 0:
            print(
                f"Recuperación        : docker start {args.kill_container} "
                f"{args.restart_after}s después"
            )
        schedule_replica_stop(args.kill_container, args.kill_after, args.restart_after)

    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = []
        for worker_id in range(args.concurrency):
            futures.append(
                executor.submit(
                    stress_worker,
                    worker_id,
                    args.gateway_base,
                    args.lb_health_url,
                    languages,
                    args.max_clients,
                    args.timeout,
                    args.action_delay,
                    stop_at,
                    stats,
                )
            )
        for future in futures:
            future.result()

    summary = stats.snapshot()
    print("\n" + "=" * 65)
    print("REPORTE DE STRESS")
    print("=" * 65)
    print(f"Total requests : {summary['total']}")
    print(f"Exitosos       : {summary['success']}")
    print(f"Fallidos       : {summary['error']}")
    print(f"Success rate   : {summary['success_rate']:.2f}%")
    print(f"P50 latency ms : {summary['p50_ms']:.2f}")
    print(f"P95 latency ms : {summary['p95_ms']:.2f}")
    print(f"P99 latency ms : {summary['p99_ms']:.2f}")

    print("\nDistribución por upstream (X-LB-Upstream-Addr):")
    if not summary["by_upstream"]:
        print("  Sin datos de upstream. Verifica que el LB exponga header X-LB-Upstream-Addr.")
    else:
        for upstream, total in sorted(summary["by_upstream"].items(), key=lambda x: x[1], reverse=True):
            print(f"  {upstream:<24} -> {total}")

    print("\nPor acción:")
    for action, data in summary["by_action"].items():
        avg = (data["latency_sum"] / data["total"]) if data["total"] else 0.0
        print(
            f"  {action:<18} total={int(data['total'])} ok={int(data['ok'])} "
            f"error={int(data['error'])} avg_ms={avg:.2f}"
        )

    if summary["errors"]:
        print("\nTop errores:")
        for key, qty in sorted(summary["errors"].items(), key=lambda x: x[1], reverse=True)[:10]:
            print(f"  {key} -> {qty}")

    if args.output_json:
        payload = {
            "timestamp": datetime.datetime.now().isoformat(),
            "config": {
                "gateway_base": args.gateway_base,
                "concurrency": args.concurrency,
                "duration": args.duration,
                "languages": languages,
                "max_clients": args.max_clients,
                "timeout": args.timeout,
                "action_delay": args.action_delay,
                "kill_container": args.kill_container,
                "kill_after": args.kill_after,
                "restart_after": args.restart_after,
            },
            "summary": summary,
        }
        with open(args.output_json, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        print(f"\nReporte JSON guardado en: {args.output_json}")


def build_parser():
    parser = argparse.ArgumentParser(
        description="Monitor y stress test para LSP gateway/load-balancer"
    )
    sub = parser.add_subparsers(dest="mode")

    monitor = sub.add_parser("monitor", help="Sondeo de disponibilidad simple")
    monitor.add_argument("--url", default=DEFAULT_URL, help="Compatibilidad con un solo target")
    monitor.add_argument(
        "--target",
        action="append",
        default=[],
        help="Target a monitorear con formato nombre=url. Se puede repetir varias veces.",
    )
    monitor.add_argument("--interval", default=DEFAULT_INTERVAL, type=float)
    monitor.add_argument("--duration", default=DEFAULT_DURATION, type=float)
    monitor.add_argument("--umbral", default=UMBRAL_MINIMO, type=float)

    stress = sub.add_parser("stress", help="Prueba de carga concurrente + failover")
    stress.add_argument("--gateway-base", default=DEFAULT_GATEWAY_BASE)
    stress.add_argument("--lb-health-url", default=DEFAULT_LB_HEALTH)
    stress.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    stress.add_argument("--duration", type=float, default=90)
    stress.add_argument("--languages", default="python,cpp,typescript")
    stress.add_argument("--max-clients", type=int, default=4)
    stress.add_argument("--timeout", type=float, default=5.0)
    stress.add_argument("--action-delay", type=float, default=DEFAULT_ACTION_DELAY)
    stress.add_argument("--seed", type=int, default=42)
    stress.add_argument("--kill-container", default="")
    stress.add_argument("--kill-after", type=float, default=25)
    stress.add_argument("--restart-after", type=float, default=0)
    stress.add_argument("--output-json", default="stress-report.json")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    mode = args.mode or "monitor"
    if mode == "monitor":
        targets = [parse_target(raw) for raw in args.target]
        if not targets:
            targets = [("gateway", args.url)]
        resultados = availability_monitor(targets, args.interval, args.duration)
        availability_report(resultados, args.umbral)
        return

    if args.lb_health_url and args.lb_health_url.strip():
        # Validación rápida previa al stress para capturar errores de ruteo temprano.
        probe = request_with_metrics(
            requests.Session(),
            "GET",
            args.lb_health_url,
            "lb_health_precheck",
            args.timeout,
        )
        status = "OK" if probe.ok else f"FALLO ({probe.status})"
        print(f"[Precheck] LB health {args.lb_health_url}: {status}")

    run_stress(args)


if __name__ == "__main__":
    main()
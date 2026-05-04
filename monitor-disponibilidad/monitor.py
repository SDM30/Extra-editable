import argparse
import time
import datetime
import requests

DEFAULT_URL      = "http://localhost:8080/api/health"
DEFAULT_INTERVAL = 1       
DEFAULT_DURATION = 20     
TIMEOUT          = 3       
UMBRAL_MINIMO    = 90.0    


def parse_target(raw: str):
    if "=" not in raw:
        return raw, raw

    name, url = raw.split("=", 1)
    return name.strip() or url.strip(), url.strip()


def sondear(url: str) -> bool:
    try:
        resp = requests.get(url, timeout=TIMEOUT)
        return resp.status_code == 200
    except requests.RequestException:
        return False


def monitorear(targets, intervalo, duracion):
    resultados = {name: [] for name, _ in targets}
    fin = time.time() + duracion
    n = 0

    print(f"\n[Inicio] {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Intervalo: {intervalo}s  |  Duración: {duracion}s")
    for name, url in targets:
        print(f"- {name}: {url}")
    print("-" * 55)

    while time.time() < fin:
        n += 1
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        for name, url in targets:
            ok = sondear(url)
            print(f"  [{ts}] Sondeo #{n:>3} [{name}]: {'OK' if ok else 'FALLO'}")
            resultados[name].append(ok)
        time.sleep(intervalo)

    return resultados


def reporte(resultados, umbral):
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

        print(f"  Target         : {nombre}")
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url",      default=DEFAULT_URL, help="Compatibilidad con un solo target")
    parser.add_argument(
        "--target",
        action="append",
        default=[],
        help="Target a monitorear con formato nombre=url. Se puede repetir varias veces.",
    )
    parser.add_argument("--interval", default=DEFAULT_INTERVAL, type=float)
    parser.add_argument("--duration", default=DEFAULT_DURATION, type=float)
    parser.add_argument("--umbral",   default=UMBRAL_MINIMO,    type=float)
    args = parser.parse_args()

    targets = [parse_target(raw) for raw in args.target]
    if not targets:
        targets = [("gateway", args.url)]

    resultados = monitorear(targets, args.interval, args.duration)
    reporte(resultados, args.umbral)


if __name__ == "__main__":
    main()
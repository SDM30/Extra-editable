import argparse
import time
import datetime
import requests

DEFAULT_URL      = "http://localhost:8080/api/health"
DEFAULT_INTERVAL = 1       
DEFAULT_DURATION = 20     
TIMEOUT          = 3       
UMBRAL_MINIMO    = 90.0    


def sondear(url: str) -> bool:
    try:
        resp = requests.get(url, timeout=TIMEOUT)
        return resp.status_code == 200
    except requests.RequestException:
        return False


def monitorear(url, intervalo, duracion):
    resultados = []
    fin = time.time() + duracion
    n = 0

    print(f"\n[Inicio] {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"URL: {url}  |  Intervalo: {intervalo}s  |  Duración: {duracion}s")
    print("-" * 55)

    while time.time() < fin:
        n += 1
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        ok = sondear(url)
        print(f"  [{ts}] Sondeo #{n:>3}: {'OK' if ok else 'FALLO'}")
        resultados.append(ok)
        time.sleep(intervalo)

    return resultados


def reporte(resultados, umbral):
    total    = len(resultados)
    exitosos = sum(resultados)
    pct      = (exitosos / total * 100) if total else 0

    print("\n" + "=" * 55)
    print("REPORTE DE DISPONIBILIDAD")
    print("=" * 55)
    print(f"  Sondeos totales : {total}")
    print(f"  Exitosos        : {exitosos}")
    print(f"  Fallidos        : {total - exitosos}")
    print(f"  Disponibilidad  : {pct:.2f} %")
    print(f"  Umbral requerido: {umbral:.1f} % ")
    print("-" * 55)
    if pct >= umbral:
        print("Cumple el requisito de disponibilidad")
    else:
        print(f"NO cumple (déficit de {umbral - pct:.2f} %)")
    print("=" * 55)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url",      default=DEFAULT_URL)
    parser.add_argument("--interval", default=DEFAULT_INTERVAL, type=float)
    parser.add_argument("--duration", default=DEFAULT_DURATION, type=float)
    parser.add_argument("--umbral",   default=UMBRAL_MINIMO,    type=float)
    args = parser.parse_args()

    resultados = monitorear(args.url, args.interval, args.duration)
    reporte(resultados, args.umbral)


if __name__ == "__main__":
    main()
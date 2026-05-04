#!/usr/bin/env python3
"""
Script principal para pruebas LSP
Uso:
    python3 test_clients.py -p <PORT> <CLIENT_ID>   # Modo persistente
    python3 test_clients.py -e <PORT>               # Modo extra (prueba límite)
    python3 test_clients.py -m <PORT> <COUNT>       # Múltiples persistentes
"""

import sys
import signal
import time
import argparse
from persistent_client import PersistentClient, ConnectionTester


def run_persistent(port: str, client_id: str):
    """Ejecuta un cliente persistente"""
    url = f"ws://127.0.0.1:{port}"
    
    # Configurar signal handlers
    signal.signal(signal.SIGTERM, lambda s, f: sys.exit(0))
    signal.signal(signal.SIGINT, lambda s, f: sys.exit(0))
    
    # Callback cuando se inicializa
    def on_initialized(client):
        print(f"[{client_id}] ✅ Listo para recibir peticiones", flush=True)
    
    # Crear y ejecutar cliente
    client = PersistentClient(url, f"client_{client_id}", verbose=True)
    client.set_on_initialized(on_initialized)
    
    print(f"🚀 Iniciando cliente persistente {client_id} en {url}")
    client.run()


def run_extra(port: str):
    """Prueba una conexión extra (para verificar límites)"""
    url = f"ws://127.0.0.1:{port}"
    
    print(f"🧪 Probando conexión extra a {url}")
    print()
    
    tester = ConnectionTester(url, timeout=3)
    result = tester.test_connection()
    tester.print_result(result)
    
    # Retornar código de salida apropiado
    if result["rejected"]:
        sys.exit(0)  # Rechazado = comportamiento esperado
    elif result["success"]:
        sys.exit(1)  # Aceptado = límite no funciona
    else:
        sys.exit(2)  # Error


def run_multiple(port: str, count: int):
    """Lanza múltiples clientes persistentes (para usar desde bash)"""
    import subprocess
    import os
    
    print(f"🚀 Lanzando {count} clientes persistentes...")
    print()
    
    processes = []
    script_path = os.path.abspath(__file__)
    
    for i in range(1, count + 1):
        proc = subprocess.Popen([
            sys.executable, script_path, "-p", port, str(i)
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        processes.append(proc)
        print(f"   ✓ Cliente {i} lanzado (PID: {proc.pid})")
        time.sleep(0.5)
    
    print()
    print(f"✅ {count} clientes lanzados")
    print("Presiona Ctrl+C para detener todos")
    print()
    
    try:
        # Esperar
        for proc in processes:
            proc.wait()
    except KeyboardInterrupt:
        print("\n🛑 Deteniendo clientes...")
        for proc in processes:
            proc.terminate()
        for proc in processes:
            proc.wait(timeout=2)
        print("✅ Clientes detenidos")


def main():
    parser = argparse.ArgumentParser(
        description="Cliente LSP para pruebas",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  %(prog)s -p 32768 1          # Cliente persistente con ID 1
  %(prog)s -e 32768            # Probar conexión extra
  %(prog)s -m 32768 4          # Lanzar 4 clientes persistentes
        """
    )
    
    parser.add_argument("-p", "--persistent", nargs=2, metavar=("PORT", "ID"),
                       help="Ejecutar cliente persistente")
    parser.add_argument("-e", "--extra", metavar="PORT",
                       help="Probar conexión extra (límite)")
    parser.add_argument("-m", "--multiple", nargs=2, metavar=("PORT", "COUNT"),
                       help="Lanzar múltiples clientes persistentes")
    
    args = parser.parse_args()
    
    if args.persistent:
        port, client_id = args.persistent
        run_persistent(port, client_id)
    elif args.extra:
        run_extra(args.extra)
    elif args.multiple:
        port, count = args.multiple
        run_multiple(port, int(count))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
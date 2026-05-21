#!/usr/bin/env python3
"""Descubre instancias vivas de collab-service y regenera nginx.config.

El watcher comprueba una lista de puertos candidatos contra /dev-token,
reescribe el upstream con solo las instancias vivas y recarga Nginx.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
NGINX_CONF_PATH = Path(os.getenv('NGINX_CONF_PATH', BASE_DIR / 'nginx.config'))
POLL_INTERVAL = int(os.getenv('POLL_INTERVAL', '2'))
DISCOVERY_HOST = os.getenv('COLLAB_DISCOVERY_HOST', '127.0.0.1')
UPSTREAM_HOST = os.getenv('COLLAB_UPSTREAM_HOST', 'host.docker.internal')
DISCOVERY_PORTS = [
    int(port.strip())
    for port in os.getenv('COLLAB_DISCOVERY_PORTS', '1234,1235,1236').split(',')
    if port.strip()
]
START_MARKER = '# {{COLLAB_INSTANCES_BEGIN}}'
END_MARKER = '# {{COLLAB_INSTANCES_END}}'


def discover_live_ports() -> list[int]:
    """Devuelve los puertos que responden correctamente a /dev-token."""
    live_ports: list[int] = []

    for port in DISCOVERY_PORTS:
        payload = json.dumps({'userId': 'lb-discovery', 'username': 'lb-discovery'}).encode('utf-8')
        request = urllib.request.Request(
            f'http://{DISCOVERY_HOST}:{port}/dev-token',
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )

        try:
            with urllib.request.urlopen(request, timeout=1.5) as response:
                body = json.loads(response.read().decode('utf-8'))
                if response.status == 200 and isinstance(body.get('token'), str) and body['token']:
                    live_ports.append(port)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError):
            continue

    return live_ports


def render_upstream_lines(ports: list[int]) -> str:
    if not ports:
        return '        # Sin instancias vivas detectadas; nginx responderá 502 hasta que aparezca una.'

    return '\n'.join(
        f'        server {UPSTREAM_HOST}:{port} max_fails=3 fail_timeout=30s;'
        for port in ports
    )


def rewrite_nginx_config(ports: list[int]) -> bool:
    """Reemplaza el bloque gestionado por el watcher y devuelve si cambió."""
    if not NGINX_CONF_PATH.exists():
        raise FileNotFoundError(f'No existe nginx.config: {NGINX_CONF_PATH}')

    original = NGINX_CONF_PATH.read_text(encoding='utf-8')
    pattern = re.compile(
        re.escape(START_MARKER) + r'.*?' + re.escape(END_MARKER),
        re.DOTALL,
    )

    replacement = START_MARKER + '\n' + render_upstream_lines(ports) + '\n        ' + END_MARKER
    updated = pattern.sub(replacement, original)

    if updated == original:
        return False

    NGINX_CONF_PATH.write_text(updated, encoding='utf-8')
    return True


def reload_nginx() -> None:
    """Recarga Nginx dentro del contenedor o en el host, según el entorno."""
    docker_bin = shutil.which('docker')
    if docker_bin:
        result = subprocess.run(
            [docker_bin, 'ps', '--format', '{{.Names}}'],
            capture_output=True,
            text=True,
            check=False,
        )
        containers = {line.strip() for line in result.stdout.splitlines() if line.strip()}
        if 'collab-lb' in containers:
            subprocess.run([docker_bin, 'exec', 'collab-lb', 'nginx', '-t'], check=True)
            subprocess.run([docker_bin, 'exec', 'collab-lb', 'nginx', '-s', 'reload'], check=True)
            return

    nginx_bin = shutil.which('nginx')
    if nginx_bin:
        subprocess.run([nginx_bin, '-t', '-c', str(NGINX_CONF_PATH)], check=True)
        subprocess.run([nginx_bin, '-s', 'reload'], check=True)


def main() -> None:
    last_ports: list[int] | None = None

    print('[collab-lb] Discovery watcher iniciado')
    print(f'[collab-lb] Puertos candidatos: {DISCOVERY_PORTS}')
    print(f'[collab-lb] Host de probe: {DISCOVERY_HOST}')
    print(f'[collab-lb] Host upstream: {UPSTREAM_HOST}')
    print(f'[collab-lb] Config: {NGINX_CONF_PATH}')

    while True:
        live_ports = discover_live_ports()
        if live_ports != last_ports:
            print(f'[collab-lb] Instancias vivas detectadas: {live_ports}')
            if rewrite_nginx_config(live_ports):
                try:
                    reload_nginx()
                    print('[collab-lb] nginx.config actualizado y recargado')
                except subprocess.CalledProcessError as error:
                    print(f'[collab-lb] Error recargando Nginx: {error}')
            else:
                print('[collab-lb] Sin cambios en nginx.config')
            last_ports = live_ports

        time.sleep(POLL_INTERVAL)


if __name__ == '__main__':
    main()
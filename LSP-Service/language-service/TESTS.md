# Ejecutar tests LSP (WS, REST, lifecycle)

Este documento explica cómo preparar el entorno, arrancar el servicio LSP localmente y ejecutar los tests de integración para WS, REST y lifecycle.

Rutas de interés:
- Tests: [LSP-Service/tests](LSP-Service/tests)
- Router principal modificado: [LSP-Service/language-service/app/routers/lsp.py](LSP-Service/language-service/app/routers/lsp.py)

Requisitos previos
- macOS / Linux (instrucciones Unix). 
- Python 3.11+ (se probó con Python 3.13 en este entorno).
- Opcional: Docker si quieres que `lifecycle.create_container` use contenedores reales.
- (Opcional) Redis si deseas que el servicio registre latidos; el servicio funciona aunque Redis no esté disponible.

Pasos rápidos (recomendado)

1) Abrir terminal y entrar en la carpeta del servicio:

```bash
cd LSP-Service/language-service
```

2) Crear y activar un entorno virtual (recomendado):

```bash
python3 -m venv .venv
source .venv/bin/activate
```

3) Instalar dependencias (el proyecto incluye `require.txt`):

```bash
pip install --upgrade pip
pip install -r require.txt
# Si falta 'uvicorn[standard]' o websockets, instala:
pip install "uvicorn[standard]" websockets
```

4) (Opcional) Exportar variables de entorno útiles:

```bash
export PROJECTS_DIR=/tmp/lsp_projects
export PORT=8135         # puerto donde correrá esta réplica
export JWT_SECRET=jwt-secreto  # usado por los tests para firmar tokens
# Si quieres cambiar la URL que usan los tests:
export LSP_BASE_URL=http://127.0.0.1:8135
```

5) Arrancar el servicio (en segundo plano, escribiendo logs y pid):

```bash
PROJECTS_DIR=/tmp/lsp_projects PORT=8135 python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8135 > /tmp/lsp-service-8135.log 2>&1 & echo $! > /tmp/lsp-service-8135.pid
```

6) Verificar que el servicio esté arriba:

```bash
curl -i http://127.0.0.1:8135/health
# o mirar logs:
tail -n 50 /tmp/lsp-service-8135.log
```

7) Ejecutar los tests (desde la raíz del repo o desde `LSP-Service/language-service`):

```bash
# Desde el directorio del servicio:
LSP_BASE_URL=http://127.0.0.1:8135 python3 -m pytest -q /Users/admin/Documents/ArquitecturaSoftware/Extra-editable/LSP-Service/tests/test_lsp_ws.py /Users/admin/Documents/ArquitecturaSoftware/Extra-editable/LSP-Service/tests/test_lsp_rest.py /Users/admin/Documents/ArquitecturaSoftware/Extra-editable/LSP-Service/tests/test_lsp_lifecycle.py

# O ejecutar todos los tests del paquete:
LSP_BASE_URL=http://127.0.0.1:8135 python3 -m pytest -q /Users/admin/Documents/ArquitecturaSoftware/Extra-editable/LSP-Service/tests
```

Notas y troubleshooting
- Si ves en logs mensajes como `Unsupported upgrade request` y `No supported WebSocket library detected`, instala `websockets` o ejecuta `pip install "uvicorn[standard]"`.
- Si `POST /lsp/<project>` devuelve 401/403, revisa `JWT_SECRET` y que el token usado por los tests tenga el claim `room` con el mismo `project_id`.
- Si necesitas Redis en la misma máquina (opcional):
  - macOS (Homebrew): `brew install redis && brew services start redis`
  - Linux: `sudo apt install redis-server` o usar un contenedor Docker `docker run -p 6379:6379 redis`
- Logs del servicio: `/tmp/lsp-service-8135.log` por defecto (ver el comando de arranque para la ruta usada).

Qué hice al ajustar el servicio (contexto)
- El endpoint `POST /lsp/{project_id}` acepta ahora cuerpo vacío (`{}`) aplicando valores por defecto para `language` y `max_clients`.
- Se añadió un endpoint WebSocket en `/lsp/{project_id}/ws` para aceptar el handshake en tests.
- `GET /lsp/` devuelve una lista de entradas en lugar de un objeto con `containers/total` (los tests esperan una lista).

¿Quieres que cree un `Makefile` o script `scripts/run-tests.sh` con estos pasos automatizados?
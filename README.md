# Extra Editable

Aplicación de edición colaborativa con frontend Angular, backend Django/DRF, persistencia en PostgreSQL y un flujo de colaboración protegido por JWT.

## Stack

- Frontend: Angular 21
- Backend: Django 4.2 + Django REST Framework
- Base de datos: PostgreSQL
- Colaboración en tiempo real: Hocuspocus/Yjs
- Gateway: Nginx en `8080`
- Balanceador colaborativo: Nginx en `8083`

## Arranque rápido

El script recomendado para levantar todo el stack local es [start-all.ps1](start-all.ps1) en Windows o [start-all.sh](start-all.sh) en Bash/Git Bash/WSL.

Ese arranque levanta:

- PostgreSQL local
- backend Django en `8000`
- frontend Angular en `4200`
- gateway Nginx en `8080`
- balanceador colaborativo en `8083`
- tres instancias de `collab-service` en `1234`, `1235` y `1236`

### Windows

```powershell
.\start-all.ps1
```

### Bash / Git Bash / WSL

```bash
./start-all.sh
```

## Detener y limpiar

### Detener todos los servicios

```bash
./stop-all.sh
```

Mata los procesos del host (backend, frontend, collab, watcher LSP), detiene y elimina los contenedores Docker del proyecto y cierra túneles SSH en puertos 8080/8050.

### Reiniciar desde cero (Docker)

```bash
./reset-docker.sh
```

Elimina **todos** los contenedores, imágenes, redes y volúmenes Docker del proyecto. Útil para pruebas limpias antes de un nuevo `start-all.sh`. Las imágenes base (`nginx:alpine`, `redis:7-alpine`, `postgres:15-alpine`) no se eliminan porque pueden ser compartidas con otros proyectos.

## Requisitos

- Python 3.10+
- Node.js 20+
- npm
- Docker

> `start-all.sh` verifica automáticamente `docker`, `python3`, `node` y `npm` antes de arrancar. Si falta alguno, aborta con un mensaje de error.

## Variables clave

El script `start-all.sh` acepta un argumento opcional para el secreto JWT y exporta las siguientes variables de entorno para todos los servicios:

### Base de datos

```bash
DB_ENGINE=django.db.backends.postgresql
DB_NAME=extra_editable
DB_USER=postgres
DB_PASSWORD=postgres
DB_HOST=localhost
DB_PORT=5432
```

### Autenticación y colaboración

```bash
JWT_SECRET="${1:-jwt-secreto}"       # Argumento opcional del script
COLLAB_JWT_SECRET="$JWT_SECRET"      # Mismo secreto que JWT (compartido entre backend y collab-service)
```

> El backend y `collab-service` deben compartir el mismo `JWT_SECRET` para que el token de colaboración sea válido en todo el flujo.

### Red (Docker ↔ host)

```bash
ALLOWED_HOSTS="localhost,127.0.0.1,172.17.0.1,host.docker.internal"
```

> `172.17.0.1` es la IP del gateway de Docker en Linux. Necesaria para que los contenedores nginx (gateway y balanceador) puedan alcanzar el backend via `host.docker.internal`.

### Depuración

```bash
# Si DEBUG está seteado como "release", se fuerza a "False"
if [ "${DEBUG:-}" = "release" ]; then
  export DEBUG="False"
fi
```

### Configuración de Docker

El script usa `--add-host=host.docker.internal:host-gateway` en los contenedores nginx para que resuelvan `host.docker.internal` a la IP del host. En macOS/Windows con Docker Desktop esto se resuelve automáticamente; en Linux es necesario el flag.

### Servicio colaborativo

Cada instancia del collab-service recibe las mismas variables de base de datos que el backend:

```bash
PORT=1234                           # 1234, 1235 o 1236 según la instancia
JWT_SECRET="$JWT_SECRET"           # Compartido con el backend
DB_ENGINE=django.db.backends.postgresql
DB_NAME=extra_editable
DB_USER=postgres
DB_PASSWORD=postgres
DB_HOST=localhost
DB_PORT=5432
```

### Usuarios iniciales

El script ejecuta `manage.py seed --force` que crea 7 usuarios y resetea sus passwords cada vez que arranca:

| Usuario | Rol | Contraseña |
|---|---|---|
| admin1 | ADMIN | Admin1234! |
| david | USUARIO | User1234! |
| samuel | USUARIO | User1234! |
| santiago | USUARIO | User1234! |
| simon | USUARIO | User1234! |
| melissa | USUARIO | User1234! |
| gabriel | USUARIO | User1234! |

## Flujo de colaboración

1. El frontend autentica al usuario contra el backend.
2. Al entrar a un proyecto, el frontend pide un token de colaboración.
3. Ese token se guarda en la cookie `collab_token`.
4. El gateway valida la cookie contra el backend antes de reenviar el WebSocket al balanceador colaborativo.
5. El balanceador distribuye la conexión entre las instancias de `collab-service` usando sticky sessions.

## Balanceador colaborativo

La configuración del balanceador está en [collab-load-balancer/nginx.config](collab-load-balancer/nginx.config). Está pensada para ejecutarse con Docker y escuchar en `8083`.

Si necesitas levantarlo manualmente, usa la misma configuración del balanceador y asegúrate de tener tres instancias de `collab-service` activas en `1234`, `1235` y `1236`.

## Notas

- El flujo de arranque ya no incluye el servicio de ejecución de código ni el balanceador LSP.
- Si cambias `JWT_SECRET`, debes usar el mismo valor en backend y en todas las instancias de colaboración.
- Si limpias cookies o cambias de usuario, vuelve a autenticarse para regenerar `collab_token`.
- **Linux:** El script ya incluye `--add-host host.docker.internal:host-gateway` y `ALLOWED_HOSTS` con `172.17.0.1` para que los contenedores Docker puedan alcanzar los servicios del host. En Windows/macOS Docker Desktop resuelve `host.docker.internal` automáticamente.
- Si el backend se inicia manualmente (sin `start-all.sh`), asegúrate de usar `0.0.0.0:8000` para que sea accesible desde los contenedores Docker.

Después, el frontend y el gateway principal deben apuntar al balanceador de colaboración:

- `http://localhost:8083/dev-token`
- `ws://localhost:8083`

### 8. Pruebas rápidas del servicio colaborativo

Para validar que todo quedó levantado y que la colaboración no pierde estado al cambiar de archivo o de pestaña, usar esta secuencia:

```bash
# 1. Verificar el balanceador
curl http://localhost:8083/health

# 2. Pedir un token de prueba
curl -X POST http://localhost:8083/dev-token \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-1","username":"Tester"}'

# 3. Probar WebSocket
npx wscat -c "ws://localhost:8083?token=TU_TOKEN"
```

Si el editor sigue perdiendo contenido al cambiar de archivo, revisar también que:

- `backend` esté corriendo en `http://localhost:8000`
- `frontend` esté corriendo en `http://localhost:4200`
- `collab-service` tenga instancias activas en `1234`, `1235` y `1236`
- todas las instancias compartan el mismo `JWT_SECRET`

Para comprobar sticky sessions de forma manual, abrir dos pestañas del mismo navegador y verificar que ambas mantengan su presencia/cambios al alternar entre archivos.

## LSP Service

Pruebas de resiliencia del agente sidecar, autenticación JWT y ejecución del Servicio de Lenguaje:
ver [LSP-Service/README.md](LSP-Service/README.md) y [lsp-load-balancer/README.md](lsp-load-balancer/README.md).

El diseño de arquitectura y recuperación automática está documentado en la
[wiki del Servicio de Lenguaje](Extra-editable.wiki/Servicio-de-lenguaje.md).

## Pruebas de autenticación LSP (JWT)

Todos los endpoints REST y conexiones WebSocket del Servicio de Lenguaje requieren
un token JWT scoped al proyecto. El backend emite tokens LSP en
`POST /api/projects/{id}/lsp/token/` con payload `{sub, username, room, exp}`.

```bash
# 1. Login
ACCESS=$(curl -s -X POST http://localhost:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"samuel","password":"User1234!"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['access'])")

# 2. Obtener token LSP para el proyecto (usá un ID de proyecto que te pertenezca)
LSP_TOKEN=$(curl -s -X POST http://localhost:8000/api/projects/2/lsp/token/ \
  -H "Authorization: Bearer $ACCESS" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 3. Sin token → 401
curl -i http://localhost:8080/lsp/2
# → HTTP/1.1 401 Unauthorized
#   {"detail":"Token requerido"}

# 4. Con token → 200 (crea contenedor LSP multiplexor)
curl -s http://localhost:8080/lsp/2 \
  -H "Authorization: Bearer $LSP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"language":"python"}' | python3 -m json.tool
# → container_id, ws_url, ws_port, etc.

# 5. Token de proyecto A en endpoint de proyecto B → 403
curl -i http://localhost:8080/lsp/99 \
  -H "Authorization: Bearer $LSP_TOKEN"
# → HTTP/1.1 403 Forbidden
#   {"detail":"No pertenece al proyecto 99"}

# 6. WebSocket sin token → rechazado
npx wscat -c "ws://localhost:32768"
# → Disconnected (code: 1008, reason: Token requerido)

# 7. WebSocket con token → conectado
WS_URL=$(curl -s http://localhost:8080/lsp/2 \
  -H "Authorization: Bearer $LSP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"language":"python"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['ws_url'])")
npx wscat -c "${WS_URL}?token=${LSP_TOKEN}"
# → Connected (press CTRL+C to quit)
```

El flujo completo de autenticación es:

```
Frontend → POST /auth/login/ → access_token
         → POST /projects/{id}/lsp/token/ (Bearer access_token) → lsp_token {room}
         → REST /lsp/{id} (Bearer lsp_token) → valida JWT + room == project_id
         → WS ws://host:port?token=lsp_token → multiplexor valida JWT + room == PROJECT_ID
```

## Cambios recientes en `start-all.sh`

- **Verificación de prerrequisitos**: ahora `start-all.sh` comprueba `docker`, `python3`, `node` y `npm` antes de arrancar. Si falta alguno, aborta con un mensaje.
- **LSP Load Balancer en red LSP**: el contenedor `lsp-lb` se crea con `--network lsp-service_lsp-network` y se conecta también a `bridge` para que el gateway (8080) pueda alcanzarlo.
- **Watcher con venv**: `update_nginx.py` se ejecuta con `./venv/bin/python3` (entorno virtual local) en vez del `python3` del sistema.
- **Watcher recarga nginx del contenedor**: usa `docker exec lsp-lb nginx -s reload` en lugar de requerir nginx instalado en el host.
- **Build automático de `lsp-multiplexor`**: si la imagen no existe, `start-all.sh` la construye desde `LSP-Service/lsp-container/` antes de levantar el watcher.
- **API gateway corrige proxy_pass**: `/api/` ahora apunta a `host.docker.internal:8000` (Django) en vez de `:8080`.

# Distribuición VM
| Name | Username | Password | IP_Address | Servicios |
|------|----------|----------|------------|-----------|
| S. Osorio | estudiante | | 10.43.99.252 | Control Node (solo Ansible) |
| Simón | estudiante | F0c4-16M4p4c | 10.43.99.67 | LSP Service (réplica) |
| David | estudiante | arquiDavid911 | 10.43.98.3 | Backend + Frontend + Gateway + Collab LB |
| S. Campos | estudiante | C4m4l30n+26C | 10.43.99.20 | LSP Load Balancer |
| Gabriel | estudiante | Gorila/32Ard | 10.43.100.88 | LSP Service (primario) |
| Chitiva | estudiante | Ll4m4/47M0n0 | 10.43.99.41 | Code Execution Service |
| Melissa | estudiante | Pulp0/373l3f | 10.43.100.126 | Collab Service (3 instancias) |
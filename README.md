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

## Requisitos

- Python 3.13+ o el launcher `py`
- Node.js 22+
- npm
- Docker

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

## Pruebas de resiliencia del LSP (agente sidecar)

Cada máquina nodo del Servicio de Lenguaje incluye un contenedor sidecar `lsp-agent` que vigila
y recupera las instancias del language-service. El agente descubre los contenedores por label
de Docker (`lsp.service=api`) y los reinicia automáticamente si caen.

```bash
cd LSP-Service
docker compose up -d --build    # levanta language-service + agent

# 1. Verificar que el agente está corriendo
docker compose logs agent
# Debe mostrar: "[agent] iniciando, label: lsp.service=api, intervalo: 10s"

# 2. Verificar que descubrió los contenedores LSP
docker compose logs agent | grep "no healthy" || echo "todo healthy"

# 3. Simular caída del language-service (stop, NO rm)
docker stop lsp-service-language-service-1

# 4. Verificar que el agente detecta y reinicia (≤10s)
docker compose logs -f agent
# Debe mostrar: "[agent] lsp-service-language-service-1 no healthy → docker start"
#               "[agent] docker start lsp-service-language-service-1"

# 5. Confirmar que el contenedor revivió
docker ps --filter label=lsp.service=api
```

El balanceador LSP (en la máquina LB) ejecuta `update_nginx.py` que:
- Lee instancias vivas desde Redis (`SMEMBERS lsp:instances` + heartbeat TTL).
- Si detecta **cero instancias** por 3 polls consecutivos (6s), publica un comando `SPAWN`
  en el canal Redis Pub/Sub `lb:lsp:commands`.
- Los agentes sidecar en cada nodo reciben `SPAWN` y hacen `docker start` de sus contenedores LSP.

Para probar el ciclo completo de auto-recovery (LB + agente):

```bash
# En la máquina LB:
cd lsp-load-balancer
python3 update_nginx.py          # watcher con Redis discovery + Pub/Sub

# En cada máquina nodo:
cd LSP-Service
docker compose up -d --build

# Forzar caída total:
docker stop $(docker ps -q --filter label=lsp.service=api)

# El LB publicará SPAWN en ≤36s (30s TTL heartbeat + 6s polls).
# Los agentes recibirán SPAWN y re-levantarán los contenedores.
# Verificar en logs del agente: "SPAWN recibido → iniciando"
```

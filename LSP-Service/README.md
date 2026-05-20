# USO DEL SERVIDOR DE LENGUAJE (API)

Este servicio expone un API HTTP (FastAPI) que crea y destruye contenedores Docker con el LSP correspondiente (python/cpp/typescript).

> ℹ️ La documentación de diseño, arquitectura y recuperación automática está en la [wiki del Servicio de Lenguaje](../Extra-editable.wiki/Servicio-de-lenguaje.md).

## Requisitos
- Python 3.10+
- Docker Engine con acceso al socket
- Node.js 20+ (para construir la imagen)


### Docker (daemon + permisos)

En Linux con systemd:

```
sudo systemctl enable --now docker.socket
sudo systemctl enable --now docker.service
```

Permisos para usar Docker sin `sudo`:

```
sudo usermod -aG docker $USER
newgrp docker  # o cierra sesión y vuelve a entrar
docker ps
```

## 1) Construir e instalar (scripts automatizados)

Usar los scripts provistos para construir, instalar y desplegar:

- `./setup-dev.sh [num_instancias]` — instalación completa: construye la imagen `lsp-server`, crea el entorno Python (venv), instala dependencias, crea `.env` y levanta los servicios con Docker Compose.
- `./deploy-dev.sh [num_instancias]` — despliegue rápido: `up -d --build --scale language-service=<n>`.
- `./create-lsp-dev.sh <puertos...>` — crear contenedores LSP en las instancias del API (p. ej. `./create-lsp-dev.sh 32771 32772`).

Ejemplo:
```
./setup-dev.sh 1
# o para arrancar rápidamente:
./deploy-dev.sh 1
```

Si `docker images` muestra la imagen pero el API dice que no existe, revisa que estés usando el mismo Docker daemon/context:

```
docker context show
```

## 2) Instalar dependencias del API

El script `./setup-dev.sh` se encarga de crear un entorno virtual en `language-service/venv` e instalar dependencias desde `require.txt`. Si se prefiere hacerlo manualmente:

```
cd language-service
python3 -m venv venv
source venv/bin/activate
pip install -r require.txt
deactivate
```

### 3) Configurar Variables de Entorno

#### Desarrollo local

El script `./setup-dev.sh` crea automáticamente `language-service/.env`. Para ajustarlo manualmente:

```bash
PROJECTS_DIR=/home/$USER/projects
WS_PUBLIC_HOST=127.0.0.1
CONTAINER_IDLE_TIMEOUT=300000
MAX_CLIENTS_PER_CONTAINER=4
JWT_SECRET=jwt-secreto
```

#### Despliegue multi-máquina

Copiar `.env.multi` a `.env` en cada máquina del clúster y ajustar los valores:

```bash
cp .env.multi .env
```

Variables clave por máquina:

| Variable | Máquina A | Máquina B | Máquina C |
|----------|-----------|-----------|-----------|
| `WS_PUBLIC_HOST` | IP de A | IP de B | IP de C |
| `PORT` | 8135 | 8136 | 8137 |
| `REDIS_HOST` | **Misma IP** (Redis centralizado) | | |
| `JWT_SECRET` | **Mismo valor** en todas las máquinas | | |
| `LSP_INTERNAL_SECRET` | **Mismo valor** (si se configura) | | |

Contenido completo de `.env.multi`:

```
WS_PUBLIC_HOST=192.168.20.217   # ← IP ruteable de esta máquina
REDIS_HOST=192.168.20.217       # ← IP de la máquina Redis
REDIS_PORT=6379
REDIS_DB=0
PORT=8135
PROJECTS_DIR=/home/projects
CONTAINER_IDLE_TIMEOUT=300000
MAX_CLIENTS_PER_CONTAINER=4
JWT_SECRET=jwt-secreto
LSP_INTERNAL_SECRET=change-me-in-production
```

## 4) Arrancar el servidor

Para desarrollo y despliegue automatizado, usar los scripts:

- `./setup-dev.sh [num_instancias]` — instalación y arranque completo.
- `./deploy-dev.sh [num_instancias]` — despliegue rápido con Docker Compose.

Ejecutar ejemplo:

```
./deploy-dev.sh 1
# o para instalar y arrancar:
./setup-dev.sh 1
```

### Linux
** Importante para que se conecte al API Gateway **
127.0.0.1 (localhost) es un loopback exclusivo del contenedor/namespace. Cuando un contenedor Docker intenta conectarse a host.docker.internal:8135, en realidad necesita acceder al IP del host real, no al loopback.
```
cd language-service
source venv/bin/activate
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8135
deactivate
```


## Peticiones de ejemplo

> ⚠️ Todos los endpoints REST requieren autenticación JWT. Obtener un token LSP del backend:
> `POST /api/projects/{id}/lsp/token/` con `Authorization: Bearer <access_token>`.

Crear contenedor LSP:

```
# 1. Obtener access token (login)
ACCESS=$(curl -s -X POST http://localhost:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"samuel","password":"User1234!"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['access'])")

# 2. Obtener token LSP para el proyecto
LSP_TOKEN=$(curl -s -X POST http://localhost:8000/api/projects/2/lsp/token/ \
  -H "Authorization: Bearer $ACCESS" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 3. Crear contenedor (vía balanceador :8080)
curl -X POST http://localhost:8080/lsp/2 \
  -H "Authorization: Bearer $LSP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"language": "python"}'
```

Consultar estado:

```
curl http://localhost:8080/lsp/2 \
  -H "Authorization: Bearer $LSP_TOKEN"
```

Eliminar contenedor:

```
curl -X DELETE http://localhost:8080/lsp/2 \
  -H "Authorization: Bearer $LSP_TOKEN"
```

Conectar WebSocket al multiplexor LSP:

```
WS_URL=$(curl -s http://localhost:8080/lsp/2 \
  -H "Authorization: Bearer $LSP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"language":"python"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['ws_url'])")
npx wscat -c "${WS_URL}?token=${LSP_TOKEN}"
```

## Volumen del proyecto (workspace)

Por defecto se monta `${PROJECTS_DIR:-~/projects}/<project_id>` en el contenedor como `/workspace`.

Si el servicio corre como otro usuario (p. ej. root/systemd), configura `PROJECTS_DIR` para fijar la ruta base:

```
export PROJECTS_DIR=/home/simondm/projects
```

# USO DEL CONTENEDOR DEL LSP (manual)

El propósito de usar el contenedor manualmente es solo para probar su funcionamiento; en operación normal debe ser controlado por el API.

**Python (TCP 2087)**

```
docker run --rm -e LANGUAGE=python -p 2087:2087 lsp-server:latest
```

**C++**

```
docker run --rm -it -e LANGUAGE=cpp lsp-server:latest
```

**Typescript**

```
docker run --rm -it -e LANGUAGE=typescript lsp-server:latest
```

## Pruebas (ps + grep) dentro del contenedor

En otra terminal, obtén el ID del contenedor:

```
docker ps
```

Y valida el proceso según el lenguaje:

**Python**

```
docker exec <ID_CONTENEDOR> bash -lc "ps aux | grep -E '[p]ylsp'"
```

**C++**

```
docker exec <ID_CONTENEDOR> bash -lc "ps aux | grep -E '[c]langd'"
```

**Typescript**

```
docker exec <ID_CONTENEDOR> bash -lc "ps aux | grep -E '[t]ypescript-language-server|[n]ode.*typescript-language-server'"
```

## 📁 Estructura del Proyecto

```
LSP-Service/
├── Makefile                   # Atajos para tareas y scripts
├── setup-dev.sh               # Instalación completa y arranque (construye imagen, venv, .env, up)
├── deploy-dev.sh              # Despliegue rápido (docker compose up -d --build --scale)
├── create-lsp-dev.sh          # Crear contenedores LSP apuntando a instancias del API
├── discover-dev.sh            # Descubrir instancias del API y crear LSPs automáticamente
├── cleanup-dev.sh             # Eliminar contenedores de prueba creados por los scripts
├── deploy-multi.sh            # Despliegue multi-máquina
├── agent/                     # Contenedor sidecar de recuperación
│   ├── Dockerfile
│   └── agent.py               # Watchdog + subscriber Redis (SPAWN)
├── docker-compose.yml         # Definición de servicios (API, agent, redis)
├── lsp-container/             # Imagen Docker del multiplexor LSP
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── package.json
│   ├── server.js
│   └── config/
│       └── lsp-servers.js
├── language-service/          # API FastAPI para gestión de contenedores
│   ├── app/
│   │   ├── main.py            # Punto de entrada de la API
│   │   ├── routers/
│   │   │   └── lsp.py         # Endpoints REST
│   │   └── services/
│   │       ├── lifecycle.py   # Gestión de contenedores Docker
│   │       └── registry.py    # Registro en memoria de contenedores activos
│   └── .env                   # Variables de entorno (WS_PUBLIC_HOST, PROJECTS_DIR)
└── tests/                     # Scripts de prueba
    ├── persistent_client.py
    ├── test_clients.py
    ├── test_single_client.py
    └── test_conect_limits.sh
```

## 🧰 Uso de scripts y Makefile

A continuación se detallan cómo usar los scripts principales y las reglas del Makefile.

- setup-dev.sh [num_instancias]
  - Qué hace: construcción de imagen `lsp-server`, creación de `language-service/venv`, instalación de dependencias, creación de `language-service/.env` si falta y levantado con Docker Compose.
  - Uso: `./setup-dev.sh 1` (o `make setup 1`)

- deploy-multi.sh [--build]
  - Qué hace: despliegue en una máquina del clúster multi-máquina. Requiere `.env` con `WS_PUBLIC_HOST` y `REDIS_HOST`, NFS montado en `/home/projects`, e imagen `lsp-multiplexor:latest`.
  - Uso: `./deploy-multi.sh` o `./deploy-multi.sh --build`
  - El agente sidecar se levanta automáticamente como parte del compose.

- deploy-dev.sh [num_instancias]
  - Qué hace: despliegue rápido con Docker Compose (build + up -d + escala).
  - Uso: `./deploy-dev.sh 1` (o `make deploy 1`)

- create-lsp-dev.sh [opciones] <puerto1> [puerto2...]
  - Qué hace: realiza POST al endpoint /lsp/ de instancias del API para crear contenedores LSP.
  - Opciones: `-l/--language`, `-c/--clients`, `-p/--project`, `-d/--dry-run`, `-v/--verbose`.
  - Ejemplo: `./create-lsp-dev.sh -l python -c 4 32771 32772`

- discover-dev.sh
  - Qué hace: detecta instancias del API (docker ps / compose) y ejecuta la creación automática de LSPs en ellas.
  - Uso: `./discover-dev.sh` (use `-d` para modo dry-run/descubrimiento)

- cleanup-dev.sh
  - Qué hace: elimina contenedores de prueba creados por los scripts (filtra por nombre base).
  - Uso: `./cleanup-dev.sh` (o `make cleanup-lsp`)

Makefile (resumen de targets útiles)

- `make help`        — Muestra ayuda y ejemplos.
- `make setup [n]`   — Ejecuta `./setup-dev.sh n`.
- `make deploy [n]`  — Ejecuta `./deploy-dev.sh n`.
- `make build`       — Construye imágenes (lsp-container + compose build).
- `make up [n]`      — Levanta servicios con Compose (escala language-service).
- `make down`        — Detiene servicios.
- `make create` / `make create-containers` — Ejecuta `discover-dev.sh` o `create-lsp-dev.sh`.
- `make cleanup-lsp` — Ejecuta `cleanup-dev.sh`.
- `make logs`, `make ps`, `make shell`, `make redis-cli` — Monitorización y debugging.

Ejemplos rápidos:

- Instalación + pruebas: `make setup 1 && make test-full`
- Despliegue rápido: `make deploy 1` o `./deploy-dev.sh 1`

## Pruebas de resiliencia (agente sidecar)

Cada máquina nodo incluye un contenedor sidecar `lsp-agent` que vigila y recupera
las instancias del language-service. El agente descubre los contenedores por label
de Docker (`lsp.service=api`) y los reinicia automáticamente si caen.

```bash
cd LSP-Service
docker compose up -d --build    # levanta language-service + agent

# 1. Verificar que el agente está corriendo
docker compose logs agent
# Debe mostrar: "[agent] iniciando, label: lsp.service=api, intervalo: 10s"

# 2. Simular caída del language-service (stop, NO rm)
docker stop lsp-service-language-service-1

# 3. Verificar que el agente detecta y reinicia (≤10s)
docker compose logs -f agent
# "[agent] lsp-service-language-service-1 no healthy → docker start"
# "[agent] docker start lsp-service-language-service-1"

# 4. Confirmar que el contenedor revivió
docker ps --filter label=lsp.service=api
```

El balanceador LSP (en la máquina LB) ejecuta `update_nginx.py` que:
- Lee instancias vivas desde Redis (`SMEMBERS lsp:instances` + heartbeat TTL).
- Si detecta **cero instancias** por 3 polls consecutivos (6s), publica un comando `SPAWN`
  en el canal Redis Pub/Sub `lb:lsp:commands`.
- Los agentes sidecar en cada nodo reciben `SPAWN` y hacen `docker start` de sus contenedores.

Para probar el ciclo completo de auto-recovery (LB + agente):

```bash
# En la máquina LB:
cd lsp-load-balancer
python3 update_nginx.py

# En cada máquina nodo:
cd LSP-Service
docker compose up -d --build

# Forzar caída total:
docker stop $(docker ps -q --filter label=lsp.service=api)

# El LB publicará SPAWN en ≤36s (30s TTL heartbeat + 6s polls).
# Los agentes recibirán SPAWN y re-levantarán los contenedores.
# Verificar: docker compose logs agent | grep SPAWN
```




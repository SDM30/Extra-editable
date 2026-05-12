# USO DEL SERVIDOR DE LENGUAJE (API)

Este servicio expone un API HTTP (FastAPI) que crea y destruye contenedores Docker con el LSP correspondiente (python/cpp/typescript).

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

- `./setup.sh [num_instancias]` — instalación completa: construye la imagen `lsp-server`, crea el entorno Python (venv), instala dependencias, crea `.env` y levanta los servicios con Docker Compose.
- `./deploy.sh [num_instancias]` — despliegue rápido: `up -d --build --scale language-service=<n>`.
- `./create-lsp-containers.sh <puertos...>` — crear contenedores LSP en las instancias del API (p. ej. `./create-lsp-containers.sh 32771 32772`).

Ejemplo:
```
./setup.sh 1
# o para arrancar rápidamente:
./deploy.sh 1
```

Si `docker images` muestra la imagen pero el API dice que no existe, revisa que estés usando el mismo Docker daemon/context:

```
docker context show
```

## 2) Instalar dependencias del API

El script `./setup.sh` se encarga de crear un entorno virtual en `language-service/venv` e instalar dependencias desde `require.txt`. Si se prefiere hacerlo manualmente:

```
cd language-service
python3 -m venv venv
source venv/bin/activate
pip install -r require.txt
deactivate
```

### 3) Configurar Variables de Entorno

Modificar archivo `.env` en `language-service/`:

```bash
PROJECTS_DIR=/home/$USER/projects
WS_PUBLIC_HOST=127.0.0.1
CONTAINER_IDLE_TIMEOUT=300000
MAX_CLIENTS_PER_CONTAINER=4
```

## 4) Arrancar el servidor

Para desarrollo y despliegue automatizado, usar los scripts:

- `./setup.sh [num_instancias]` — instalación y arranque completo.
- `./deploy.sh [num_instancias]` — despliegue rápido con Docker Compose.

Ejecutar ejemplo:

```
./deploy.sh 1
# o para instalar y arrancar:
./setup.sh 1
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

Crear contenedor LSP:

```
curl -X POST http://127.0.0.1:8135/lsp/proyecto-1 \
  -H "Content-Type: application/json" \
  -d '{"language": "python"}'
```

Consultar estado:

```
curl http://127.0.0.1:8135/lsp/proyecto-1
```

Eliminar contenedor:

```
curl -X DELETE http://127.0.0.1:8135/lsp/proyecto-1
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
├── setup.sh                   # Instalación completa y arranque (construye imagen, venv, .env, up)
├── deploy.sh                  # Despliegue rápido (docker compose up -d --build --scale)
├── create-lsp-containers.sh   # Crear contenedores LSP apuntando a instancias del API
├── discover-and-create.sh     # Descubrir instancias del API y crear LSPs automáticamente
├── cleanup-containers.sh      # Eliminar contenedores de prueba creados por los scripts
├── docker-compose.yml         # Definición de servicios (API, redis, etc.)
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

- setup.sh [num_instancias]
  - Qué hace: construcción de imagen `lsp-server`, creación de `language-service/venv`, instalación de dependencias, creación de `language-service/.env` si falta y levantado con Docker Compose.
  - Uso: `./setup.sh 1` (o `make setup 1`)

- deploy.sh [num_instancias]
  - Qué hace: despliegue rápido con Docker Compose (build + up -d + escala).
  - Uso: `./deploy.sh 1` (o `make deploy 1`)

- create-lsp-containers.sh [opciones] <puerto1> [puerto2...]
  - Qué hace: realiza POST al endpoint /lsp/ de instancias del API para crear contenedores LSP.
  - Opciones: `-l/--language`, `-c/--clients`, `-p/--project`, `-d/--dry-run`, `-v/--verbose`.
  - Ejemplo: `./create-lsp-containers.sh -l python -c 4 32771 32772`

- discover-and-create.sh
  - Qué hace: detecta instancias del API (docker ps / compose) y ejecuta la creación automática de LSPs en ellas.
  - Uso: `./discover-and-create.sh` (use `-d` para modo dry-run/descubrimiento)

- cleanup-containers.sh
  - Qué hace: elimina contenedores de prueba creados por los scripts (filtra por nombre base).
  - Uso: `./cleanup-containers.sh` (o `make cleanup-lsp`)

Makefile (resumen de targets útiles)

- `make help`        — Muestra ayuda y ejemplos.
- `make setup [n]`   — Ejecuta `./setup.sh n`.
- `make deploy [n]`  — Ejecuta `./deploy.sh n`.
- `make build`       — Construye imágenes (lsp-container + compose build).
- `make up [n]`      — Levanta servicios con Compose (escala language-service).
- `make down`        — Detiene servicios.
- `make create` / `make create-containers` — Ejecuta `discover-and-create.sh` o `create-lsp-containers.sh`.
- `make cleanup-lsp` — Ejecuta `cleanup-containers.sh`.
- `make logs`, `make ps`, `make shell`, `make redis-cli` — Monitorización y debugging.

Ejemplos rápidos:

- Instalación + pruebas: `make setup 1 && make test-full`
- Despliegue rápido: `make deploy 1` o `./deploy.sh 1`




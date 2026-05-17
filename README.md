# FRONTEND

Angular CLI       : 21.1.3

Node.js           : 22.19.0

Package Manager   : npm 11.9.0

## Editor de código
Envoltorio: https://github.com/acrodata/code-editor

## Dependencias para colaboración en tiempo real
Si es la primera vez que levantan el frontend, instalar dependencias:
```
cd frontend
npm install
npm install yjs @hocuspocus/provider y-codemirror.next
```

# BACKEND

Versión de java: 25 (openjdk)

# SERVICIO DE EDICIÓN COLABORATIVA

Node.js           : 22+

Package Manager   : npm

Puerto por defecto: 1234

## Instalar dependencias
```
cd collab-service
npm install
```

## Levantar servicio colaborativo
```
npm start
```

# Ejecutar proyecto

El gateway actualmente está implementado con **Nginx** sirviendo como Proxy Inverso en el puerto 8080.

## Orden de despliegue sugerido:

### 1. Backend (Django)

**Primera vez (Configuración inicial):**
```bash
cd backend

# 1. Crear entorno virtual
python -m venv venv

# 2. Activarlo
# Windows:
.\venv\Scripts\activate
# Mac/Linux: source venv/bin/activate

# 3. Instalar dependencias
pip install -r requirements.txt

# 4. Crear archivo .env (copiar el ejemplo)
# Windows:
copy .env.example .env
# Mac/Linux: cp .env.example .env

# 5. Migraciones
python manage.py makemigrations users projects
python manage.py migrate

# 6. Datos dummy de la BD
python manage.py seed
```

**Levantar el servidor (ejecuciones posteriores):**
Una vez hecho lo anterior (o si ya lo habías hecho antes), solo necesitas asegurarte de tener el entorno virtual activado y ejecutar el servidor apuntando al puerto **8081**:
```bash
cd backend
# Activar entorno virtual si no lo está: .\venv\Scripts\activate
python manage.py runserver 8081
```

> Para el flujo colaborativo, usa la misma variable `JWT_SECRET` en backend y `collab-service`. Si no defines un valor, el ejemplo por defecto es `jwt-secreto`.

Si vas a usar PostgreSQL, agrega estas variables en tu `.env`:
```bash
DB_ENGINE=django.db.backends.postgresql
DB_NAME=extra_editable
DB_USER=postgres
DB_PASSWORD=postgres
DB_HOST=localhost
DB_PORT=5432
```

### 2. Servicio de edición colaborativa (Hocuspocus)
```bash
cd collab-service
npm install
npm start
```
*(Corre en el puerto 1234)*

Para persistir el contenido de los documentos y evitar que se reinicien al caer una instancia, este servicio también puede usar PostgreSQL con las mismas variables `DB_*` o `DATABASE_URL`.

Para usar el balanceador de colaboración, levanta varias instancias del servicio en terminales distintas:
**PowerShell (Windows):**
```powershell
# Terminal 1
cd collab-service
$env:PORT=1234; $env:JWT_SECRET='jwt-secreto'; node src/server.js

# Terminal 2
cd collab-service
$env:PORT=1235; $env:JWT_SECRET='jwt-secreto'; node src/server.js

# Terminal 3
cd collab-service
$env:PORT=1236; $env:JWT_SECRET='jwt-secreto'; node src/server.js
```

**Bash / WSL / Git Bash:**
```bash
# Terminal 1
cd collab-service
PORT=1234 JWT_SECRET=jwt-secreto node src/server.js

# Terminal 2
cd collab-service
PORT=1235 JWT_SECRET=jwt-secreto node src/server.js

# Terminal 3
cd collab-service
PORT=1236 JWT_SECRET=jwt-secreto node src/server.js
```

> Nota: se puede copiar `.env.example` a `.env` y editar `JWT_SECRET` allí. Siempre asegurarse de usar el mismo `JWT_SECRET` en todas las instancias y en el backend.

## Scripts de arranque 

Se incluyen dos scripts en la raíz para arrancar el backend y tres instancias de `collab-service` con el mismo `JWT_SECRET`.

- `start-all.ps1` — PowerShell, abrir nuevas ventanas para backend y cada instancia de `collab-service`.
  - Uso recomendado (PowerShell) — ejecuta con el operador `&` para invocar el script y forzar kill si es necesario:
    ```powershell
    & .\start-all.ps1 -JwtSecret 'jwt-secreto' -ForceKill -StartFrontend
    ```
  - Ejecutar sin forzar kill (preguntará si hay puertos ocupados):
    ```powershell
    & .\start-all.ps1 -JwtSecret 'jwt-secreto' -StartFrontend
    ```
  - Nota: no pegues el comando dentro de bloques de código cuando lo ejecutes en la terminal; usa `&` antes de la ruta si la ejecutas desde la carpeta del repo.

- `start-all.sh` — Bash, arranca los procesos en background y escribe logs en `logs/`.
  - Uso básico:
    ```bash
    ./start-all.sh jwt-secreto
    ```

Notas:
- Ejecuta los scripts desde la raíz del proyecto (`.`). Los puertos por defecto para `collab-service` son `1234`, `1235`, `1236`.
- Si ya tienes procesos en esos puertos, detenlos antes de ejecutar los scripts (ver `netstat` / `Stop-Process` en Windows).
- Los logs del script Bash quedan en `logs/`.


### 3. Servicio de ejecución de código
Acceder a la carpeta
```bash
cd code-execution-service
```
Correr el proyecto
```bash
npm run dev
```

### 4. Nginx (API Gateway)
Desde la raíz del proyecto, levanta un contenedor de nginx pasando nuestro archivo de configuración.

**Para Windows (PowerShell):**
```bash
docker run --rm --name api-gateway -p 8080:8080 -v "${PWD}/nginx.conf:/etc/nginx/nginx.conf:ro" nginx
```

**Para Mac / Git Bash:**
```bash
docker run --rm --name api-gateway -p 8080:8080 -v "$(pwd)/nginx.conf:/etc/nginx/nginx.conf:ro" nginx
```
*(Corre en el puerto 8080 y enrutará todo el tráfico hacia tus demás servicios locales)*

**Para Linux:**
```bash
docker run --rm --name api-gateway -p 8080:8080 \
  --add-host host.docker.internal:host-gateway \
  -v "$(pwd)/nginx.conf:/etc/nginx/nginx.conf:ro" \
  nginx
```

### 5. Frontend (Angular)
```bash
cd frontend
ng serve
```
*(Corre en el puerto 4200)*

### 6. Balanceador de cargas
```bash
cd lsp-load-balancer
nginx -c $(pwd)/nginx.conf
```

### 7. Balanceador de colaboración
Este balanceador expone Hocuspocus en el puerto **8083** y distribuye el tráfico entre varias instancias de `collab-service`.

> **Estado actual recomendado:** usar Docker para el balanceador y levantar
> tres instancias del servicio colaborativo en `1234`, `1235` y `1236` con el
> mismo `JWT_SECRET`. Esa es la forma que estamos usando ahora para probar
> colaboración, awareness y sticky sessions.

**Opción 1: Nginx instalado en la máquina**

```bash
cd collab-load-balancer

# Verificar la configuración
nginx -t -c $(pwd)/nginx.config

# Levantarlo en foreground (desarrollo)
nginx -c $(pwd)/nginx.config -g "daemon off;"

# O levantarlo en background
nginx -c $(pwd)/nginx.config
```

**Opción 2: Nginx en Docker**

Se puede levantar el balanceador con Docker. Este contenedor usa la configuración del proyecto y expone el puerto `8083`.

**Windows / PowerShell:**
```powershell
 $mount = Join-Path $PWD 'collab-load-balancer\nginx.config'
docker run -d --name collab-lb -p 8083:8083 `
  -v "$mount:/etc/nginx/nginx.conf:ro" `
  nginx:alpine
```

> La variable se llama `JWT_SECRET`, pero el valor de ejemplo puede ser cualquier texto, por ejemplo `"jwt secreto"`.

**Linux / macOS / Git Bash:**
```bash
docker run -d --name collab-lb -p 8083:8083 \
  --add-host host.docker.internal:host-gateway \
  -v "$(pwd)/collab-load-balancer/nginx.config:/etc/nginx/nginx.conf:ro" \
  nginx:alpine
```

> En Linux añadir `--add-host host.docker.internal:host-gateway` porque el
> contenedor tiene que alcanzar las instancias de `collab-service` que corren
> en el host. En Windows/macOS Docker Desktop ya resuelve ese nombre.

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

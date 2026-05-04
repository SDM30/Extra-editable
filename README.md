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

### 2. Servicio de edición colaborativa (Hocuspocus)
```bash
cd collab-service
npm install
npm start
```
*(Corre en el puerto 1234)*

### 3. Servicio de ejecución de código (FastAPI Dockerizado)
```bash
docker build -t code-execution-service -f code-execution-service/Dockerfile code-execution-service
```

Para iniciar el contenedor, puedes mapear el puerto del anfitrión al `8000` del contenedor:
```bash
docker run --rm -p PUERTO_ANFITRION:8000 code-execution-service
```

Ejemplo (puerto 8000):
```bash
docker run --rm -p 8000:8000 code-execution-service
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

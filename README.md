# FRONTEND

Angular CLI       : 21.1.3

Node.js           : 22.19.0

Package Manager   : npm 11.9.0

## Editor de código
Envoltorio: https://github.com/acrodata/code-editor

# BACKEND

Versión de java: 21 (openjdk)

# Ejecutar proyecto

## Frontend
1. Iniciar proyecto de angular
```
ng serve
```
## Backend
2. Iniciar aplicación de spring
```
mvn spring-boot:run
```
## Servicio de ejecución de código
1. Crear imagen a partir del Dockerfile
```
docker build -t code-execution-service -f code-execution-service/Dockerfile code-execution-service
```
2. Iniciar el contenedor en el puerto 8000

```
docker run --rm -p PUERTO_ANFITRION:PUERTO_CONTENEDOR code-execution-service
```


```
docker run --rm -p 8000:8000 code-execution-service
```
## Monitor
Para correr el monitor.py:
```
pip install requests
```
```
python monitor.py
```


## Prueba de Carga: comparación de escenarios (con cola vs sin cola)

### Objetivo
Evaluar cómo RabbitMQ protege el sistema ante picos de demanda al encolar solicitudes de ejecución de código en lugar de procesarlas directamente.

### Requisitos previos
- Docker y Docker Compose (para RabbitMQ)
- Maven 3.9+
- JDK 21
- Python 3.13+ con FastAPI y Uvicorn (para el runner)

### Escenario A: Sin cola (Ejecución directa)

1. **Terminal 1 - Levantar el backend:**
   ```
   cd backend
   mvn spring-boot:run
   ```

2. **Terminal 2 - Levantar el runner Python:**
   ```
   cd code-execution-service
   py -m pip install -r requirements.txt
   py -m uvicorn app.main:server --host 0.0.0.0 --port 8000
   ```

3. **Terminal 3 - Ejecutar la prueba:**
   ```
   cd backend/scripts
   powershell -ExecutionPolicy Bypass -File .\poc-carga.ps1 -Escenario sin-cola -Total 30 -VentanaSegundos 2
   ```

### Escenario B: Con cola (RabbitMQ)

1. **Terminal 1 - Levantar RabbitMQ:**
   ```
   docker compose up -d
   ```

2. **Terminal 2 - Levantar el backend:**
   ```
   cd backend
   mvn spring-boot:run
   ```

3. **Terminal 3 - Ejecutar la prueba:**
   ```
   cd backend/scripts
   powershell -ExecutionPolicy Bypass -File .\poc-carga.ps1 -Escenario con-cola -Total 30 -VentanaSegundos 2
   ```

**Comparación esperada:**
- Sin cola: latencia alta (~4.5s promedio), tiempo total largo (~69s)
- Con cola: latencia baja (~170ms promedio), tiempo total corto (~8s)

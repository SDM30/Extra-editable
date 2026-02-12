# FRONTEND

Angular CLI       : 21.1.3

Node.js           : 22.19.0

Package Manager   : npm 11.9.0

## Editor de código
Envoltorio: https://github.com/acrodata/code-editor

# BACKEND

Versión de java: 25 (openjdk)

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
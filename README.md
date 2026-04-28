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

## Servicio de edición colaborativa
1. Iniciar servicio colaborativo
```
cd collab-service
npm start
```

Salida esperada:
```
[collab] Servidor en http/ws://localhost:1234
[collab] Endpoint de token de prueba: POST http://localhost:1234/dev-token
```
## API Gateway
1. Iniciar el API Gateway en el puerto 8080. Todas las peticiones del frontend deben apuntar a este puerto.
```
cd api-gateway
mvn spring-boot:run
```
2. Iniciar frontend (en otra terminal)
```
cd frontend
ng serve
```

3. Probar conexión en dos pestañas
Abrir dos pestañas en:
```
http://localhost:4200
```

En la terminal de collab-service deben aparecer dos conexiones al room:
```
[collab] ... se unió a "room-editor-1"
```

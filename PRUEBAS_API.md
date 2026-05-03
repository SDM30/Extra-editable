# Plan de Pruebas QA - API Gateway (Nginx)

Este documento centraliza todos los comandos actualizados (y adaptados para PowerShell) para validar la correcta integración de todos los microservicios a través del Proxy Inverso en Nginx (`localhost:8080`).

## Prerrequisitos
Si vas a probar las conexiones WebSocket desde terminal, instala `wscat`:
```powershell
npm install -g wscat
```

---

## 1. PRUEBAS DE HUMO (Infraestructura y CORS)

### 1.1 Verificar configuración Nginx y Preflight (CORS OPTIONS)
```powershell
curl.exe -i -X OPTIONS -H "Origin: http://localhost:4200" -H "Access-Control-Request-Method: POST" http://localhost:8080/api/
```
*(Debe retornar `204 No Content` con cabeceras `Access-Control-Allow-Origin: http://localhost:4200`)*

### 1.2 Verificar proxy hacia el backend (Django)
```powershell
curl.exe -I http://localhost:8080/api/
```
*(Debe retornar `401 Unauthorized` o `404 Not Found` proveniente de Django. Esto confirma que Nginx enrutó el tráfico exitosamente, descartando errores `502 Bad Gateway`)*

### 1.3 Verificar que el header Authorization llega intacto
```powershell
curl.exe -i -H "Authorization: Bearer token_falso" http://localhost:8080/api/
```
*(Debe retornar `401 Unauthorized` de Django)*

---

## 2. PRUEBAS DE AUTENTICACIÓN (Servicios REST - Django)

### 2.1 Login para obtener JWT
```powershell
curl.exe -i -X POST http://localhost:8080/api/auth/login/ -H "Content-Type: application/json" -d '{\"username\":\"samuel\",\"password\":\"User1234!\"}'
```
*(Obtendrás un token de acceso. Cópialo para usarlo en el siguiente paso).*

### 2.2 Petición autenticada a rutas protegidas
```powershell
curl.exe -i -H "Authorization: Bearer TU_TOKEN_REAL" http://localhost:8080/api/projects/
```
*(Debe retornar un `200 OK` con los datos JSON del proyecto).*

### 2.3 Intentos no autorizados
```powershell
# Sin token
curl.exe -i http://localhost:8080/api/projects/

# Token inválido
curl.exe -i -H "Authorization: Bearer un_token_inventado" http://localhost:8080/api/projects/
```
*(Ambos deben retornar `401 Unauthorized`)*

---

## 3. PRUEBAS DE WEBSOCKET (Collab Service - Hocuspocus)

### 3.1 Conexión con trailing slash y obtención de token de servicio
```powershell
# Paso 1: Obtener token temporal/dev de colaboración Hocuspocus (Apunta directamente al puerto interno por diseño)
curl.exe -X POST http://localhost:1234/dev-token -H "Content-Type: application/json" -d '{\"userId\":\"user-001\",\"username\":\"samuel\"}'

# Paso 2: Conectar vía WebSocket a través del Nginx (Reemplaza TU_TOKEN_COLLAB)
wscat -c "ws://localhost:8080/collab/?token=TU_TOKEN_COLLAB"
```
*(Debe mostrar `Connected (press CTRL+C to quit)` confirmando que Nginx actualizó el protocolo de conexión exitosamente).*

---

## 4. PRUEBAS DE EJECUCIÓN DE CÓDIGO (FastAPI Docker)

### 4.1 Enviar código evitando problemas de escaping en PowerShell
```powershell
# Paso 1: Crear un archivo con el payload JSON esperado por FastAPI
'{"contenido": "#include <iostream>\nint main(){ std::cout << \"Hola\"; return 0; }"}' | Out-File -Encoding utf8 payload.json

# Paso 2: Ejecutar la solicitud inyectando el archivo como body
curl.exe -X POST http://localhost:8080/ejecutar/run -H "Content-Type: application/json" --data "@payload.json"
```
*(Debe retornar `200 OK` con un JSON conteniendo `"resultado": "Hola"`).*

---

## 5. PRUEBAS NEGATIVAS

### 5.1 Bloqueo en ruta inexistente en Nginx
```powershell
curl.exe -I http://localhost:8080/ruta-inventada/
```
*(Debe retornar `404 Not Found` validado por el propio Nginx).*

### 5.2 Interceptación de peticiones HTTP puras a ruta WebSocket
```powershell
curl.exe -i http://localhost:8080/collab/
```

### 5.3 Bypass Test (Comprobando que Django ya NO gestiona el CORS)
```powershell
curl.exe -i -X OPTIONS -H "Origin: http://localhost:4200" http://localhost:8081/api/
```
*(NO deben aparecer cabeceras de CORS en la respuesta directa al puerto `8081` de Django).*
# Collab Load Balancer — Balanceador para el Servicio de Edición Colaborativa

Balanceador Nginx independiente que distribuye conexiones WebSocket entre múltiples
instancias de **collab-service** (Hocuspocus + Yjs).

---

## Por qué este balanceador es diferente al del LSP

| Característica | LSP Load Balancer | **Collab Load Balancer** |
|----------------|-------------------|--------------------------|
| Algoritmo      | Round-robin       | **ip_hash (sticky)**     |
| Protocolo      | HTTP REST         | **WebSocket long-lived** |
| Estado         | Redis compartido  | **Memoria por instancia** |
| Motivo         | Cada request es independiente | Un doc Yjs vive en UNA instancia |

El servicio Hocuspocus mantiene el estado de cada documento (el `Y.Doc`, el awareness de cursores, el snapshot) **en memoria** de la instancia que lo cargó. Si un cliente se reconecta a una instancia distinta, esa instancia no tiene el documento → el cliente recibe un documento vacío y sobreescribe el contenido colaborativo.

La solución es **sticky sessions por IP** (`ip_hash` en Nginx): el mismo cliente siempre llega a la misma instancia mientras esta esté viva.

> **Escalado horizontal:** Si en el futuro se necesita escalar sin sticky
> sessions, habrá que persistir los documentos Yjs en una capa compartida
> (Redis con `y-redis`, PostgreSQL, etc.) y recargar el doc desde ahí en cada
> conexión nueva. El servidor ya tiene el hook `onLoadDocument`/`onStoreDocument`
> preparado para eso (`documentSnapshots` en `server.js`).

---

## Arquitectura

```
Frontend (http://localhost:4200)
    ↓
Nginx Principal (puerto 8080)
    ↓ /collab/  o  /collab
Collab Load Balancer (puerto 8083)   ← ip_hash sticky
    ↓                ↓                ↓
[collab :1234]  [collab :1235]  [collab :1236]
  Doc A, B         Doc C           Doc D, E
```

---

## Prerrequisitos

- **Docker** para correr el balanceador como contenedor
- **Node.js 22+** para correr las instancias de `collab-service`
- **Mismo `JWT_SECRET` en todas las instancias** para que el token firmado por el backend sea válido en todo el clúster

---

## Configuración

### 1. Levantar múltiples instancias de collab-service

Cada instancia necesita su propio puerto y, opcionalmente, su propio secreto JWT (aunque lo más sencillo es compartir el mismo `JWT_SECRET`).

```bash
# Instancia 1 (ya existente)
cd collab-service
PORT=1234 JWT_SECRET=jwt-secreto node src/server.js

# Instancia 2 (nueva terminal)
PORT=1235 JWT_SECRET=jwt-secreto node src/server.js

# Instancia 3 (nueva terminal, opcional)
PORT=1236 JWT_SECRET=jwt-secreto node src/server.js
```

Si usas `npm start` el puerto viene del `.env`. Puedes crear múltiples archivos
`.env.1234`, `.env.1235`, etc. o exportar `PORT` antes de ejecutar.

### 2. Levantar el balanceador Nginx

**Recomendado en el flujo actual: Docker**

```powershell
 $mount = Join-Path $PWD 'collab-load-balancer\nginx.config'
docker run -d --name collab-lb -p 8083:8083 `
    -v "$mount:/etc/nginx/nginx.conf:ro" `
    nginx:alpine
```

> La variable sigue llamándose `JWT_SECRET`; para el ejemplo usar un valor como `"jwt-secreto"`.

En Linux/macOS/Git Bash:

```bash
docker run -d --name collab-lb -p 8083:8083 \
    --add-host host.docker.internal:host-gateway \
    -v "$(pwd)/collab-load-balancer/nginx.config:/etc/nginx/nginx.conf:ro" \
    nginx:alpine
```

Con Nginx instalado localmente, también funciona:

```bash
cd collab-load-balancer

# Verificar configuración
nginx -t -c $(pwd)/nginx.conf

# Levantar en foreground (desarrollo)
nginx -c $(pwd)/nginx.conf -g "daemon off;"

# O en background
nginx -c $(pwd)/nginx.conf
```

### 3. Flujo de autenticación del gateway

El balanceador valida el token con el backend en `POST /api/projects/validate-collab-token/` usando `auth_request`. Si la validación es correcta, Nginx reenvía la identidad al `collab-service` en estas cabeceras internas:

- `X-Auth-User-Id`
- `X-Auth-Username`
- `X-Auth-Room`

El servicio colaborativo acepta esas cabeceras cuando el gateway ya autenticó la petición, y usa JWT como respaldo si la conexión llega sin identidad inyectada.

### 4. Actualizar el Nginx principal

En `nginx.conf` (raíz del proyecto), cambia el upstream de `/collab/` y `/collab` para que apunten a este balanceador en lugar de directamente a `:1234`:

```nginx
location /collab/ {
    # ANTES: proxy_pass http://host.docker.internal:1234/;
    # DESPUÉS:
    proxy_pass http://host.docker.internal:8083/;

    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host       $host;
    proxy_read_timeout  3600s;
    proxy_send_timeout  3600s;
    proxy_pass_request_headers on;
}

location = /collab {
    # Mismo cambio
    proxy_pass http://host.docker.internal:8083/;
    # ...mismas directivas...
}
```

---

## Verificar que funciona

```bash
# 1. Health check del balanceador
curl http://localhost:8083/health
# → {"status":"ok","service":"collab-load-balancer"}

# 2. Pedir un token de prueba (igual que antes, pero ahora pasa por el LB)
curl -X POST http://localhost:8083/dev-token \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-1","username":"Tester"}'
# → {"token":"eyJ..."}

# 2b. Validar el token por el backend (flujo usado por auth_request)
curl "http://localhost:8000/api/projects/validate-collab-token/?token=TU_TOKEN"
# → {"ok":true}

# 3. Probar conexión WebSocket
npx wscat -c "ws://localhost:8083?token=TU_TOKEN"
# → Connected

# 4. Verificar sticky sessions — dos peticiones del mismo host deben
#    llegar siempre a la misma instancia. Agrega X-Instance-Port en cada
#    instancia para comprobarlo (ver sección de diagnóstico).
```

## Flujo actual recomendado para probar el servicio

1. Levantar el backend en `http://localhost:8000`.
2. Levantar el frontend en `http://localhost:4200`.
3. Levantar tres instancias de `collab-service`:

```powershell
$env:JWT_SECRET='jwt-secreto'; $env:PORT=1234; node src/server.js
$env:JWT_SECRET='jwt-secreto'; $env:PORT=1235; node src/server.js
$env:JWT_SECRET='jwt-secreto'; $env:PORT=1236; node src/server.js
```

4. Levantar el balanceador en `http://localhost:8083`.
5. Abrir dos pestañas, entra al mismo proyecto/archivo y confirmar que:
    - los cambios aparecen en ambas pestañas
    - al cambiar de archivo no se borra el contenido local
    - el colaborador autenticado sigue apareciendo en la lista

## Verificación mínima adicional

Si el problema se repite, probar estos checks antes de abrir el editor:

- `curl http://localhost:8083/health`
- `curl -X POST http://localhost:8083/dev-token -H "Content-Type: application/json" -d '{"userId":"u1","username":"Tester"}'`
- `npx wscat -c "ws://localhost:8083?token=TU_TOKEN"`
- revisar que el frontend esté apuntando a `ws://localhost:8083` y no a una instancia directa

---

## Comprobar sticky sessions

Agrega temporalmente este middleware al comienzo de `collab-service/src/server.js`
para identificar qué instancia responde:

```js
// Solo para diagnóstico — eliminar en producción
import http from 'http';
const PORT_ID = process.env.PORT || '1234';

// En el handler onRequest de Hocuspocus:
async onRequest({ request, response }) {
    response.setHeader('X-Instance-Port', PORT_ID);
    // ... resto del handler
}
```

Luego:

```bash
for i in {1..6}; do
  echo "Petición $i → $(curl -si http://localhost:8083/dev-token \
    -X POST -H 'Content-Type: application/json' \
    -d '{"userId":"u","username":"u"}' | grep X-Instance-Port)"
done
```

Con `ip_hash` todas las peticiones desde tu máquina deben responder con el mismo puerto.

---

## Diferencias con el Nginx principal

El `nginx.conf` principal gestiona CORS, reescritura de rutas y actúa como gateway
para todos los servicios. Este balanceador es **un upstream especializado** que el
principal llama como si fuera una sola instancia. Separar responsabilidades permite:

- Escalar collab independientemente sin tocar el gateway
- Reiniciar el balanceador sin afectar LSP ni ejecución de código
- Ajustar timeouts WebSocket sin impactar rutas REST

---

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---------|---------------|----------|
| `502 Bad Gateway` | Ninguna instancia collab levantada en los puertos configurados | `lsof -i :1234` para verificar |
| Cursores remotos desaparecen al recargar | Sticky session rota (ip cambió o instancia cayó) | Verificar `ip_hash` en nginx.conf |
| Documento vacío al reconectar | Cliente llegó a instancia sin el doc en memoria | Sticky sessions funcionando; es comportamiento esperado si la instancia cayó. Implementar persistencia para tolerancia a fallos |
| `token inválido` al conectar con el LB | `JWT_SECRET` diferente entre instancias | Usar el mismo secreto en todas las instancias |
| Puerto 8083 ocupado | Otro proceso o instancia previa del LB | `nginx -s stop` + verificar con `lsof -i :8083` |
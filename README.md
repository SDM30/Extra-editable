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

El backend usa PostgreSQL por defecto en desarrollo con estas variables:

```bash
DB_ENGINE=django.db.backends.postgresql
DB_NAME=extra_editable
DB_USER=postgres
DB_PASSWORD=postgres
DB_HOST=localhost
DB_PORT=5432
```

El backend y `collab-service` deben compartir el mismo `JWT_SECRET` para que el token de colaboración sea válido en todo el flujo.

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

# LSP Load Balancer - Balanceador de Cargas para Servicio de Lenguaje

Balanceador Nginx independiente que distribuye peticiones entre múltiples instancias del
**Servicio de Lenguaje (API FastAPI)**, no entre contenedores LSP directamente. Cada instancia
del servicio gestiona internamente el ciclo de vida de los contenedores LSP asociados a cada
proyecto, garantizando que el multiplexor de cada contenedor sea usado exclusivamente por
el proyecto que le corresponde.

> ℹ️ La documentación de diseño de la arquitectura de recuperación automática está en la
> [wiki del Servicio de Lenguaje](../Extra-editable.wiki/Servicio-de-lenguaje.md#-arquitectura-de-recuperación-automática).

## 🏗️ Arquitectura

```
Frontend (http://localhost:4200)
    ↓
Nginx Principal (puerto 8080)
    ↓ /lsp/
LSP Load Balancer (puerto 8085) ← Nginx + update_nginx.py
    ↓↓↓ Round-robin dinámico
[LSP Service :8135] [LSP Service :8136] [LSP Service :8137]
    ↓                    ↓                    ↓
[Contenedor        [Contenedor          [Contenedor
 LSP proyecto-A]    LSP proyecto-B]      LSP proyecto-C]
```

**Descubrimiento dinámico:** `update_nginx.py` lee instancias vivas desde Redis
(`SMEMBERS lsp:instances` + heartbeat TTL) y regenera `nginx.conf` automáticamente.
Si detecta **cero instancias** por 3 polls consecutivos, publica un comando `SPAWN`
en el canal Redis Pub/Sub `lb:lsp:commands`. Los agentes sidecar en cada nodo
reciben `SPAWN` y re-levantan sus contenedores LSP.

> **¿Por qué balancear el Servicio de Lenguaje y no los contenedores LSP?**
> Cada contenedor LSP es efímero y específico de un proyecto: el multiplexor interno está
> diseñado para ser usado por un solo proyecto a la vez. El Servicio de Lenguaje (FastAPI)
> es quien gestiona qué contenedor corresponde a cada `project_id`, por lo que es la capa
> correcta para escalar horizontalmente.

## 📋 Prerequisitos

1. **Redis corriendo** con keys `lsp:instances` (Set) y `lsp:heartbeat:*` (String con TTL 30s)
2. **2-3 instancias del Servicio de Lenguaje** ejecutándose en puertos distintos (ver `LSP-Service/`)
3. El **Nginx principal** (puerto 8080) debe reenviar requests de `/lsp/` a este balanceador
4. **JWT_SECRET** compartido entre backend, LSP Service y multiplexor
5. **Imagen `lsp-multiplexor:latest`** construida (el script `start-all.sh` la construye automáticamente si no existe)

## 📦 Instalación

El script `install.sh` automatiza la puesta en marcha completa del balanceador:

```bash
cd lsp-load-balancer
./install.sh
```

Qué hace:
1. Verifica que **Nginx**, **redis-cli** y **Python** estén disponibles
2. Instala la dependencia `redis` en el venv del proyecto
3. Comprueba que **Redis** responda en `localhost:6379`
4. Crea y habilita el servicio **systemd** `lsp-watcher` para que el watcher corra siempre en background
5. Levanta Nginx con la configuración del balanceador (puerto 8085)
6. Inicia el watcher y ejecuta una verificación final

```bash
# Reinstalación forzada (detiene servicios previos)
./install.sh --force
```

---

## ⚙️ Configuración manual

### 1. Levantar el balanceador Nginx

El balanceador **debe estar corriendo antes** de levantar las instancias del servicio.
Sin Nginx activo, las peticiones del API Gateway recibirán `502 Bad Gateway`.

```bash
cd lsp-load-balancer

# Verificar configuración antes de levantar
nginx -t -c $(pwd)/nginx.conf

# Levantar en background
nginx -c $(pwd)/nginx.conf

# Verificar que está corriendo
curl http://localhost:8085/health
# {"status":"ok","service":"lsp-load-balancer"}
```

### 2. Levantar el watcher de descubrimiento dinámico

`update_nginx.py` lee instancias vivas desde Redis (`SMEMBERS lsp:instances` + heartbeat TTL)
y regenera `nginx.conf` cada vez que una instancia entra o sale. Si detecta cero instancias,
publica un comando `SPAWN` en el canal Redis Pub/Sub `lb:lsp:commands`.

```bash
cd lsp-load-balancer
./venv/bin/python3 update_nginx.py
```

Para producción, usar el servicio systemd que instala `install.sh`:
```bash
sudo systemctl start lsp-watcher
sudo journalctl -u lsp-watcher -f
```

### 3. Levantar las instancias del Servicio de Lenguaje

Desde el directorio `LSP-Service/`:

```bash
# Desplegar con Docker Compose (3 instancias + agente sidecar)
./deploy-dev.sh 3

# O si aún no están construidas las imágenes
./setup-dev.sh 3
```

### 4. Verificar registro en Redis

```bash
# Instancias registradas
redis-cli SMEMBERS lsp:instances

# Heartbeats activos (TTL 30s, refrescados cada 10s)
redis-cli KEYS lsp:heartbeat:*
redis-cli TTL lsp:heartbeat:<id>

# Contenedores LSP creados
redis-cli KEYS lsp:container:*
```

## 🔗 Integración con Nginx Principal

El archivo `nginx.conf` en la raíz del proyecto debe tener el location `/lsp/`
apuntando a este balanceador:

```nginx
location /lsp/ {
    proxy_pass http://host.docker.internal:8085;
    # ... resto de configuración CORS y headers
}
```

Flujo completo:
```
Cliente → localhost:8080/lsp/ → Nginx Principal
        → host.docker.internal:8085 → Este balanceador
        → Servicio de Lenguaje (8135 | 8136 | 8137)
        → Contenedor LSP del proyecto correspondiente
```

## 📊 Algoritmo de balanceo

- **Tipo:** Round-robin (predeterminado en Nginx)
- **Descubrimiento:** Redis (`SMEMBERS lsp:instances` + heartbeat TTL). `update_nginx.py` regenera el upstream dinámicamente cada 2s.
- **Auto-recovery:** Si 0 instancias por 3 polls (6s), el watcher publica `SPAWN` vía Redis Pub/Sub (`lb:lsp:commands`). Los agentes sidecar en cada nodo re-levantan los contenedores.
- **Registro compartido:** Redis garantiza que todas las instancias conozcan los contenedores activos, evitando duplicados por proyecto+lenguaje

## 🧯 Troubleshooting

| Problema | Solución |
|----------|----------|
| `502 Bad Gateway` desde el API Gateway | Nginx del balanceador no está corriendo — levantarlo: `nginx -c $(pwd)/nginx.conf` |
| `502 Bad Gateway` con Nginx corriendo | Las instancias del Servicio de Lenguaje no están corriendo o el upstream está vacío. Verificar: `redis-cli SMEMBERS lsp:instances` |
| `Connection refused` en puerto 8085 | Nginx no está corriendo: `ps aux \| grep nginx` |
| `Redis error on get: Connection refused` | Redis no está corriendo: `redis-cli ping` |
| Nginx corre pero upstream vacío | `update_nginx.py` no está corriendo o no detectó instancias. Verificar: `redis-cli SMEMBERS lsp:instances` y `redis-cli KEYS lsp:heartbeat:*` |
| Heartbeats expirados (TTL ausente) | La instancia del LSP Service murió. Verificar con `docker ps --filter label=lsp.service=api`. El agente sidecar debería re-levantarla en ≤10s |
| `SMEMBERS` vacío o sin heartbeats | El LSP Service no se registró en Redis. Revisar logs: `docker compose logs language-service` |
| Requests no se distribuyen | Verificar que hay 2+ instancias levantadas y que `update_nginx.py` regeneró el `nginx.conf` |
| Contenedores duplicados por proyecto | Verificar que Redis está corriendo y que `REDIS_HOST` está configurado en `.env` |
| Watcher no puede reloadear nginx | El watcher ejecuta `docker exec lsp-lb nginx -s reload`. Verificar que el contenedor `lsp-lb` esté corriendo y que el usuario tenga permisos Docker. No se requiere nginx instalado en el host. |

## 📝 Notas operacionales

- Este balanceador es **stateless** — puede levantarse y bajarse sin afectar las instancias del servicio ni los contenedores LSP activos
- El estado compartido vive en **Redis**: si Redis cae, el watcher deja de detectar instancias (nginx se queda con la última config conocida)
- Cada instancia del Servicio de Lenguaje debe tener acceso al **Docker socket** para gestionar los contenedores LSP
- Las instancias deben ser idénticas (misma versión, mismo `JWT_SECRET`, mismo acceso a Redis)
- El watcher (`update_nginx.py`) corre como servicio systemd con `User=root` para poder hacer `nginx -s reload`
- El canal Pub/Sub `lb:lsp:commands` es independiente de las keys de Redis — no interfiere con `lsp:instances` ni `lsp:container:*`
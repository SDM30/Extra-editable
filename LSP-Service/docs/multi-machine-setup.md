# LSP-Service — Guía de despliegue multi-máquina

Esta guía explica cómo desplegar el LSP-Service en múltiples máquinas físicas/virtuales
con estado compartido via Redis y sistema de archivos compartido via NFS.

## Arquitectura

```
┌─ Máquina A (10.0.0.1) ──────────────────────────────────────────┐
│  language-service:8135 ──► Docker daemon A                       │
│  NFS mount: /home/projects ←────────────────────────┐           │
└─────────────────────────────────────────────────────┼───────────┘
           │                                          │
           ▼ Redis (10.0.0.3:6379) ◄──────┤           │  NFS Server (10.0.0.3)
           │                                          │   /srv/nfs/projects
┌─ Máquina B (10.0.0.2) ─────────────────────────────┼───────────┐
│  language-service:8135 ──► Docker daemon B         │           │
│  NFS mount: /home/projects ←───────────────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

### Principios de diseño

- **Contenedores sticky:** cada máquina es dueña de los contenedores LSP que crea en su
  propio Docker daemon. El registro en Redis almacena qué máquina (`host`) creó cada
  contenedor.
- **Forward cross-machine:** cuando una instancia necesita destruir/consultar un
  contenedor que pertenece a otra máquina, forwardea la petición HTTP al API de la
  máquina dueña.
- **Sin estado local:** todo el estado compartido (registro de contenedores, heartbeat
  de instancias) vive en Redis.

---

## Paso 1: Configurar el filesystem compartido (NFS)

Todas las máquinas deben compartir el mismo directorio `/home/projects` donde se
almacenan los archivos de los proyectos.

### En el servidor NFS (máquina designada)

```bash
cd /ruta/a/LSP-Service
sudo ./scripts/setup-nfs.sh server
```

### En cada máquina del servicio (clientes NFS)

```bash
cd /ruta/a/LSP-Service
sudo ./scripts/setup-nfs.sh client 10.0.0.3
#                                  ^^^^^^^^^ IP del servidor NFS
```

El script `scripts/setup-nfs.sh` es idempotente y validará:
- Conectividad con el servidor NFS
- Instalación de paquetes necesarios
- Configuración de `/etc/fstab` para persistencia tras reinicio
- Prueba de escritura en el montaje

### Diagnóstico

```bash
./scripts/setup-nfs.sh check
```

---

## Paso 2: Exponer Redis

Redis debe ser accesible desde todas las máquinas del clúster. Hay dos opciones:

### Opción A: Redis standalone (recomendado)

Ejecutar Redis como contenedor independiente en una máquina dedicada:

```bash
# En la máquina que hosteará Redis (ej. 10.0.0.3):
docker run -d \
  --name redis-lsp \
  --restart unless-stopped \
  -p 0.0.0.0:6379:6379 \
  redis:7-alpine \
  redis-server --save "" --appendonly no --stop-writes-on-bgsave-error no
```

### Opción B: Exponer el Redis del docker-compose

Si se prefiere usar el Redis definido en `docker-compose.yml`, modificar el mapeo de
puertos para que sea accesible desde la red externa:

```yaml
redis-lsp:
  ports:
    - "0.0.0.0:6379:6379"    # Antes: "6379:6379" (solo localhost)
```

### Verificar conectividad

```bash
# Desde cualquier máquina del clúster:
redis-cli -h 10.0.0.3 -p 6379 ping
# Debe responder: PONG
```

---

## Paso 3: Construir la imagen Docker (en cada máquina)

Cada máquina necesita la imagen `lsp-multiplexor:latest` en su Docker daemon local.

```bash
# En cada máquina:
cd lsp-container
docker build -t lsp-multiplexor:latest .
```

Para entornos de producción, se recomienda un registry privado:

```bash
# Opción: taggear y pushear a un registry
docker tag lsp-multiplexor:latest registry.ejemplo.com/lsp-multiplexor:latest
docker push registry.ejemplo.com/lsp-multiplexor:latest

# En cada máquina:
docker pull registry.ejemplo.com/lsp-multiplexor:latest
docker tag registry.ejemplo.com/lsp-multiplexor:latest lsp-multiplexor:latest
```

---

## Paso 4: Configurar .env por máquina

```bash
# En cada máquina:
cp .env.multi .env
```

Editar `.env` con los valores específicos de cada máquina:

```bash
# Máquina A (10.0.0.1)
WS_PUBLIC_HOST=10.0.0.1
REDIS_HOST=10.0.0.3
PORT=8135

# Máquina B (10.0.0.2)
WS_PUBLIC_HOST=10.0.0.2
REDIS_HOST=10.0.0.3
PORT=8135
```

---

## Paso 5: Desplegar el servicio

```bash
# En cada máquina:
./deploy-multi.sh

# Para reconstruir la imagen del API:
./deploy-multi.sh --build
```

El script verifica automáticamente:
- Conectividad con Redis
- Montaje NFS en `/home/projects`
- Imagen `lsp-multiplexor:latest`
- Health check del API al finalizar

---

## Paso 6: Verificar el clúster

### 6.1 Verificar instancias registradas

```bash
redis-cli -h 10.0.0.3 smembers lsp:instances
# Ejemplo de salida:
# 10.0.0.1:8135:12345
# 10.0.0.2:8135:12346
```

### 6.2 Crear un contenedor desde la máquina A

```bash
curl -X POST http://10.0.0.1:8135/lsp/proyecto-test \
  -H "Content-Type: application/json" \
  -d '{"language": "python"}'
```

La respuesta incluirá el campo `host`:

```json
{
  "host": "10.0.0.1",
  "ws_url": "ws://10.0.0.1:32768",
  ...
}
```

### 6.3 Consultar desde la máquina B

```bash
curl http://10.0.0.2:8135/lsp/proyecto-test?language=python
```

Debe retornar la misma información, con `host: "10.0.0.1"`.

### 6.4 Destruir desde la máquina B (cross-machine forward)

```bash
curl -X DELETE "http://10.0.0.2:8135/lsp/proyecto-test?language=python"
```

La máquina B detecta que el contenedor es remoto (host=10.0.0.1) y forwardea
el destroy a `http://10.0.0.1:8135/lsp/proyecto-test/_internal/destroy`.

---

## Paso 7: Configurar el balanceador de carga

El balanceador (`lsp-load-balancer/`) distribuye peticiones REST entre todas las
instancias del API. Para multi-máquina, las IPs son las de cada máquina.

### Opción A: Actualización manual del nginx.conf

```nginx
upstream lsp_service_backend {
    server 10.0.0.1:8135 max_fails=3 fail_timeout=30s;
    server 10.0.0.2:8135 max_fails=3 fail_timeout=30s;
}
```

### Opción B: Watcher dinámico (recomendado)

El watcher `update_nginx.py` en `lsp-load-balancer/` detecta instancias via Redis.
Asegurarse de que el watcher tenga acceso a Redis:

```bash
cd lsp-load-balancer
REDIS_HOST=10.0.0.3 python3 update_nginx.py
```

---

## Troubleshooting

| Problema | Solución |
|----------|----------|
| Redis `Connection refused` | Verificar que Redis está corriendo y el puerto 6379 está abierto: `docker ps \| grep redis`, `nc -zv 10.0.0.3 6379` |
| NFS no se monta | Verificar firewall: puertos 2049 y 111. Probar `showmount -e 10.0.0.3` |
| `No existe la imagen Docker` | Construir la imagen en cada máquina: `cd lsp-container && docker build -t lsp-multiplexor:latest .` |
| Forward cross-machine falla | Verificar que `WS_PUBLIC_HOST` sea la IP ruteable (no 127.0.0.1) y que el puerto 8135 esté abierto entre máquinas |
| Contenedores duplicados | Verificar que todas las instancias apuntan al mismo Redis (`REDIS_HOST`) |
| `/_internal/destroy` 403 | Configurar `LSP_INTERNAL_SECRET` en `.env` de todas las máquinas con el mismo valor |
| Proyecto creado en A no tiene archivos en B | Verificar que NFS está montado correctamente: `ls /home/projects/` en cada máquina debe mostrar los mismos archivos |

---

## Seguridad

- El endpoint `/_internal/destroy` acepta un header `X-LSP-Internal`. Configurar
  `LSP_INTERNAL_SECRET` en producción para autenticar la comunicación entre instancias.
- En redes privadas (VPN/VPC), puede dejarse sin secreto y confiar en el aislamiento
  de red.
- Redis en producción debe usar `REDIS_PASSWORD` o TLS. Configurar en `.env`:
  `REDIS_PASSWORD=mypassword`.

---

## Limitaciones actuales

- **get_status cross-machine:** retorna `status: "remote"` en vez del estado real del
  contenedor Docker. Para ver el estado real, consultar directamente la máquina dueña.
- **get_logs cross-machine:** forwardea la petición al host dueño y retorna los logs.
- **cleanup_inactive:** solo limpia contenedores locales. En multi-máquina, cada
  instancia debe ejecutar su propia limpieza.
- **Imágenes Docker:** cada máquina necesita su propia copia de las imágenes.
  Se recomienda usar un registry privado para simplificar la distribución.

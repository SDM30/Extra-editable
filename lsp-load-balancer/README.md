# LSP Load Balancer - Balanceador de Cargas para Servicio de Lenguaje

Balanceador Nginx independiente que distribuye peticiones entre múltiples instancias del
**Servicio de Lenguaje (API FastAPI)**, no entre contenedores LSP directamente. Cada instancia
del servicio gestiona internamente el ciclo de vida de los contenedores LSP asociados a cada
proyecto, garantizando que el multiplexor de cada contenedor sea usado exclusivamente por
el proyecto que le corresponde.

## 🏗️ Arquitectura

```
Frontend (http://localhost:4200)
    ↓
Nginx Principal (puerto 8080)
    ↓ /lsp/
LSP Load Balancer (puerto 8082) ← Balanceador Nginx
    ↓↓↓ Least Conn
[LSP Service :8135] [LSP Service :8136] [LSP Service :8137]
    ↓                    ↓                    ↓
[Contenedor        [Contenedor          [Contenedor
 LSP proyecto-A]    LSP proyecto-B]      LSP proyecto-C]
```

> **¿Por qué balancear el Servicio de Lenguaje y no los contenedores LSP?**
> Cada contenedor LSP es efímero y específico de un proyecto: el multiplexor interno está
> diseñado para ser usado por un solo proyecto a la vez. El Servicio de Lenguaje (FastAPI)
> es quien gestiona qué contenedor corresponde a cada `project_id`, por lo que es la capa
> correcta para escalar horizontalmente.

## 📋 Prerequisitos

1. **Nginx instalado** en la máquina host
2. **Redis corriendo** en `localhost:6379` — requerido para el registro compartido de contenedores entre instancias
3. **2-3 instancias del Servicio de Lenguaje** ejecutándose en puertos distintos
4. El **Nginx principal** (puerto 8080) debe reenviar requests de `/lsp/` a este balanceador

## ⚙️ Configuración

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
curl http://localhost:8082/health
# {"status":"ok","service":"lsp-load-balancer"}
```

### 2. Levantar el watcher de descubrimiento dinámico

`update_nginx.py` observa Redis y regenera `nginx.conf` cada vez que una instancia
entra o sale. Debe correr en paralelo con Nginx.

```bash
cd lsp-load-balancer
python3 update_nginx.py
# En lugar de sudo python3, usar la ruta completa al python del venv
# TODO: HACERLO BIEN
sudo /home/simondm/Development/ARQ/Proyecto_ARQ/.venv_lsp/bin/python3 update_nginx.py
```

### 3. Levantar las instancias del Servicio de Lenguaje

Desde el directorio `LSP-Service/`:

```bash
# Desplegar con Docker Compose (recomendado)
make deploy 3          # 3 instancias con hot-reload
./deploy.sh 3          # equivalente directo

# O si aún no están construidas las imágenes
make setup 3           # build + deploy
./setup.sh 3           # equivalente directo

## 🔄 Verificar que el balanceador funciona

```bash
# 1. Health check del balanceador
curl -i http://localhost:8082/health
# Debe responder: {"status":"ok","service":"lsp-load-balancer"}

# 2. Verificar round-robin — observar a qué instancia llega cada petición
#    (requiere el middleware de identificación de instancia, ver sección de pruebas)
for i in {1..6}; do
    echo "Petición $i → $(curl -s -o /dev/null -D - http://localhost:8082/lsp/ | grep X-Instance-Port)"
done
```

## 🧪 Probar la distribución entre instancias

Para confirmar visualmente que el balanceador distribuye en round-robin, agrega
temporalmente este middleware en `language-service/app/main.py`:

```python
import os
from fastapi import Request

@app.middleware("http")
async def add_instance_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Instance-Port"] = str(os.getenv("PORT", "unknown"))
    return response
```

La salida esperada con round-robin:

```
Petición 1 → X-Instance-Port: 8135
Petición 2 → X-Instance-Port: 8136
Petición 3 → X-Instance-Port: 8135
Petición 4 → X-Instance-Port: 8136
```

### Verificar el registro compartido en Redis

```bash
# Observar en tiempo real las claves que se crean al gestionar contenedores
redis-cli monitor

# En otra terminal, crear un contenedor LSP
curl -X POST http://localhost:8082/lsp/proyecto-1 \
  -H "Content-Type: application/json" \
  -d '{"language": "python"}'

# Listar contenedores activos registrados en Redis
redis-cli keys "lsp:container:*"

# Ver el detalle de un contenedor específico
redis-cli get "lsp:container:proyecto-1:python"
```

## 🔗 Integración con Nginx Principal

El archivo `nginx.conf` en la raíz del proyecto debe tener el location `/lsp/`
apuntando a este balanceador:

```nginx
location /lsp/ {
    proxy_pass http://host.docker.internal:8082;
    # ... resto de configuración CORS y headers
}
```

Flujo completo:
```
Cliente → localhost:8080/lsp/ → Nginx Principal
        → host.docker.internal:8082 → Este balanceador
        → Servicio de Lenguaje (8135 | 8136 | 8137)
        → Contenedor LSP del proyecto correspondiente
```

## 📊 Algoritmo de balanceo

- **Tipo:** Round-robin (predeterminado en Nginx)
- **Comportamiento:** Cada nueva petición va a la siguiente instancia del Servicio de Lenguaje en orden
- **Registro compartido:** Redis garantiza que todas las instancias conozcan los contenedores activos, evitando duplicados por proyecto+lenguaje

## 🧯 Troubleshooting

| Problema | Solución |
|----------|----------|
| `502 Bad Gateway` desde el API Gateway | Nginx del balanceador no está corriendo — levantarlo **antes** que las instancias: `nginx -c $(pwd)/nginx.conf` |
| `502 Bad Gateway` con Nginx corriendo | Las instancias del Servicio de Lenguaje no están corriendo: `./start_instances.sh status` |
| `Connection refused` en puerto 8082 | Nginx no está corriendo: `ps aux \| grep nginx` |
| `Redis error on get: Connection refused` | Redis no está corriendo: `redis-cli ping` |
| Nginx corre pero upstream vacío | `update_nginx.py` no está corriendo o no detectó instancias: verificar `redis-cli smembers lsp:instances` |
| Requests no se distribuyen | Verificar que hay 2+ instancias levantadas y que `update_nginx.py` regeneró el `nginx.conf` |
| Contenedores duplicados por proyecto | Verificar que Redis está corriendo y que `REDIS_HOST` está configurado en `.env` |

## 📝 Notas operacionales

- Este balanceador es **stateless** — puede levantarse y bajarse sin afectar las instancias del servicio ni los contenedores LSP activos
- El estado compartido vive en **Redis**: si Redis cae, cada instancia opera con su registro local vacío hasta que Redis se recupere
- Cada instancia del Servicio de Lenguaje debe tener acceso al **Docker socket** para gestionar los contenedores LSP
- Las instancias deben ser idénticas (misma versión, mismo `.env`, mismo acceso a Docker)
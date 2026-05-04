# LSP Load Balancer - Balanceador de Cargas para Servicio de Lenguaje

Balanceador Nginx independiente que distribuye conexiones WebSocket entre múltiples instancias del servicio LSP (Language Server Protocol).

## 🏗️ Arquitectura

```
Frontend (http://localhost:4200)
    ↓
Nginx Principal (puerto 8080)
    ↓ /lsp/
LSP Load Balancer (puerto 8082) ← Balanceador Nginx
    ↓↓↓ Round-Robin
[LSP Instance 1] [LSP Instance 2] [LSP Instance 3]
```

## 📋 Prerequisitos

1. **Nginx instalado** en la máquina host
2. **2-3 instancias del servicio LSP** ejecutándose en puertos específicos
3. El **Nginx principal** (puerto 8080) debe reenviar requests de `/lsp/` a este balanceador

## ⚙️ Configuración

### 1. Definir puertos de instancias LSP

Edita `nginx.conf` en esta carpeta y actualiza el bloque `upstream lsp_backend`:

```nginx
upstream lsp_backend {
    server host.docker.internal:9001;  # LSP Instance 1
    server host.docker.internal:9002;  # LSP Instance 2
    server host.docker.internal:9003;  # LSP Instance 3 (opcional)
}
```

**Reemplaza los puertos (9001, 9002, 9003) con los puertos reales donde corre tu servicio LSP.**

### 2. Levantar el balanceador Nginx

```bash
cd lsp-load-balancer

# MacOS / Linux
nginx -c $(pwd)/nginx.conf -g "daemon off;"

# O en background
nginx -c $(pwd)/nginx.conf
```


## 🔄 Verificar que el balanceador funciona

```bash
# 1. Test básico de conectividad
curl -i http://localhost:8082/

# 2. Debe retornar una respuesta (probablemente error 400 o 502 si no hay LSP atrás)
# Eso es normal - indica que el balanceador funciona y redirige a upstream

# 3. Si ves "502 Bad Gateway" es porque los puertos de LSP en nginx.conf no existen aún
```

## 🔗 Integración con Nginx Principal

El archivo `nginx.conf` en la **raíz del proyecto** ya tiene un location `/lsp/` que debería apuntar a este balanceador:

```nginx
location /lsp/ {
    proxy_pass http://host.docker.internal:8082;
    # ... resto de configuración CORS y headers
}
```

Con esto, el flujo es:
- Cliente → `http://localhost:8080/lsp/` → Nginx Principal 
- → `http://host.docker.internal:8082` → Este balanceador
- → Distribuye entre LSP instances (9001, 9002, 9003)

## 📊 Algoritmo de balanceo

- **Tipo:** Round-robin (predeterminado en Nginx)
- **Comportamiento:** Cada nueva conexión va a la siguiente instancia en orden
- Las conexiones WebSocket se mantienen en la misma instancia (sticky por conexión)

## 🆙 Levantar múltiples instancias LSP (Ejemplo)

Si tienes un servicio LSP en un contenedor Docker, puedes levantarlo 3 veces en puertos diferentes:

```bash
# Instance 1
docker run -d -p 9001:8000 --name lsp-1 tu-imagen-lsp

# Instance 2
docker run -d -p 9002:8000 --name lsp-2 tu-imagen-lsp

# Instance 3
docker run -d -p 9003:8000 --name lsp-3 tu-imagen-lsp
```

Luego actualiza los puertos en `nginx.conf` de este balanceador.

## 🧪 Troubleshooting

| Problema | Solución |
|----------|----------|
| `502 Bad Gateway` | Los puertos en `upstream lsp_backend` no tienen servicio LSP escuchando |
| Conexión rechazada en puerto 8082 | Nginx no está corriendo, revisa: `ps aux \| grep nginx` |
| Requests no se distribuyen | Verifica que tienes 2+ instancias levantadas |
| WebSocket desconecta | Ajusta `proxy_read_timeout` / `proxy_send_timeout` en nginx.conf |

## 📝 Notas operacionales

- Este balanceador es **stateless** - puedes levantarlo/bajarlo sin afectar clientes existentes
- Cada instancia LSP debe ser idéntica (misma versión, misma configuración)
- Para **health checks avanzados**, agrega directivas `max_fails` y `fail_timeout` en el upstream
- Para **sticky sessions** (misma instancia siempre), usa `hash $remote_addr` en upstream

## 🔧 Próximos pasos

1. Asegúrate de que tienes 2-3 instancias LSP corriendo
2. Actualiza `nginx.conf` en esta carpeta con los puertos correctos
3. Levanta el balanceador
4. Verifica que el Nginx principal (puerto 8080) redirige `/lsp/` correctamente
5. Test desde frontend: `http://localhost:4200` debería comunicarse correctamente

---

**Mantenedor:** Balanceador independiente para scale horizontal del servicio LSP

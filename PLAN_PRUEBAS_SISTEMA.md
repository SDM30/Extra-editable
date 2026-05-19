# Plan de Pruebas — Sistema Colaborativo

## Fuentes de contexto

| Archivo | Información relevante para las pruebas |
|---|---|
| `code-execution-service/src/containerPool.ts` | Pool de 1 contenedor por lenguaje, `HostConfig` con límites de seguridad (`NetworkMode: none`, `Memory: 256MB`, `NanoCpus: 1`, `PidsLimit: 64`, `SecurityOpt: ['no-new-privileges']`) |
| `code-execution-service/src/dockeRunner.ts` | Timeout de ejecución 60s, polling cada 300ms, código inyectado vía variable de entorno base64 |
| `code-execution-service/src/server.ts` | WebSocket en puerto 8081, endpoint `GET /health`, cola de ejecución serializada por lenguaje |
| `backend/config/settings.py` | JWT HS256 con access token de 1h, refresh de 7d, collab de 2h; `ALLOWED_HOSTS` incluye IPs de Docker |
| `backend/projects/views.py` | `collab_join` con límite de 4 usuarios y timeout de sesión de 60s; `ValidateCollabTokenView` para el API Gateway |
| `backend/users/models.py` | Modelo `User` con campo `rol` (`USUARIO` / `ADMIN`) |
| `collab-service/src/server.js` | Servidor Hocuspocus v2.15, autenticación por headers de gateway o JWT directo, awareness, poll sync cada 1s |
| `collab-load-balancer/nginx.config` | Balanceo `ip_hash` (sticky sessions), 3 upstreams (:1234-1236), `auth_request /_auth`, `max_fails=3` |
| `lsp-load-balancer/nginx.conf` | Balanceo round-robin, 3 upstreams dinámicos, `fail_timeout=30s` |
| `LSP-Service/language-service/app/services/lifecycle.py` | Contenedores LSP por proyecto+lenguaje, idle timeout de 5 minutos, sin límites de seguridad a nivel de contenedor |
| `start-all.sh` | Orquestación de servicios, `JWT_SECRET` compartido, `ALLOWED_HOSTS`, `--add-host` para Docker, `seed --force` |
| `PRUEBAS_API.md` | Pruebas de humo del API Gateway — complementa este plan (no lo reemplaza) |

---

## 1. NF-001: Disponibilidad de escritura y ejecución

**Métrica:** Tasa de éxito de health checks y operaciones CRUD sobre una ventana de 24 horas. El objetivo es ≥90% de respuestas exitosas bajo carga simulada.

**Flujo básico:**
1. Iniciar todos los servicios vía `start-all.sh`.
2. Ejecutar un script que cada 30 segundos consulte los health checks de los servicios críticos:
   - `GET http://localhost:8081/health` (code-execution)
   - `GET http://localhost:8083/health` (collab load balancer)
   - `GET http://localhost:8085/health` (LSP load balancer)
   - `POST http://localhost:8000/api/auth/login/` con credenciales válidas (backend)
3. Simultáneamente, ejecutar una carga simulada moderada (50 ejecuciones de código por minuto, 10 creaciones de archivo por minuto).
4. Registrar éxitos, fallos y tiempos de respuesta en un archivo de log.
5. Al finalizar las 24 horas, calcular la tasa de disponibilidad como `éxitos / total × 100`.

**Herramienta:** Script bash con `curl` en loop + contador de éxito/fallo. Para la carga simulada, script Node.js con `ws` para WebSocket de ejecución.

**Referencia:** NF-001. Fuente: `server.ts` (health endpoint), `start-all.sh` (orquestación de servicios).

---

## 2. NF-008 / ADR-001: Ejecución en contenedores aislados (sandboxing)

**Métrica:** Conteo de reglas del [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html) cumplidas vs. total de reglas aplicables. Las categorías a verificar son:

| Categoría | Restricción configurada | Prueba |
|---|---|---|
| Red | `NetworkMode: 'none'` | Ejecutar código que intente conexión saliente (ping, curl, socket) |
| RAM | `Memory: 256MB` | Asignar un array de >256MB y verificar OOM kill |
| CPU | `NanoCpus: 1` | Ejecutar un busy loop y verificar que no consume >1 core |
| Procesos | `PidsLimit: 64` | Ejecutar una fork bomb y verificar que se detiene en 64 procesos |
| Privilegios | `SecurityOpt: ['no-new-privileges']` | Intentar `sudo`, `su` o ejecutar binarios setuid |
| Archivos | Sin `--read-only` (gap) | Verificar que el sistema de archivos es escribible (documentar como riesgo) |

**Flujo básico:**
1. Por cada categoría, enviar una solicitud de ejecución vía WebSocket con código diseñado para vulnerar la restricción.
2. Verificar que la respuesta del servicio indica fallo (timeout, error, OOM, permisos denegados) según lo esperado.
3. Registrar cuáles restricciones son efectivas y cuáles no.
4. Para las categorías no cubiertas (filesystem writable, sin seccomp/AppArmor), documentar como riesgos en el informe.

**Herramienta:** Script Python o Node.js que envía payloads de prueba vía WebSocket al code-execution-service y verifica las respuestas esperadas.

**Referencia:** NF-008, ADR-001. Fuente: `containerPool.ts` líneas 50-67 (`HostConfig`).

---

## 3. ADR-004 / ADR-009: Autenticación JWT y validación de credenciales

**Métrica:** 4 sub-pruebas con criterio de aprobación 100% requerido (sin excepciones).

**Flujo básico:**

| Sub-prueba | Procedimiento | Resultado esperado |
|---|---|---|
| **Generación de token** | `POST /api/auth/login/` con credenciales válidas | Respuesta 200 con `{access, refresh}` |
| **Extracción de rol** | Login como `admin1` (ADMIN) y como `david` (USUARIO); decodificar payload JWT; verificar `user_id`; consultar `GET /api/auth/me/` y verificar campo `rol` | El perfil retorna el rol correcto para cada usuario |
| **Verificación de token** | Usar `GET /api/auth/me/` con token válido (200), token expirado (401), token con firma alterada (401), sin token (401) | Cada caso retorna el código HTTP esperado |
| **Collab token** | `POST /api/projects/{id}/collab/join/` → decodificar JWT retornado → verificar claims: `sub`, `room`, `username`, `exp` | El token contiene todos los claims requeridos con valores correctos |

**Herramienta:** Script bash con `curl` + `python3` para decodificar payloads JWT (base64).

**Referencia:** ADR-004, ADR-009. Fuente: `settings.py` (`SIMPLE_JWT`), `views.py` (`collab_join`, `ValidateCollabTokenView`), `models.py` (`User.rol`).

---

## 4. ADR-005: Balanceadores de carga — efectividad

**Métrica:** Distribución de requests entre réplicas (desviación <20% de la media) y tiempo de failover (<30s con `fail_timeout=30s`).

**Flujo básico:**

**Sub-prueba A — Distribución de carga (LSP LB, round-robin):**
1. Enviar 30 requests a `GET http://localhost:8085/health`.
2. Contar cuántos requests llegaron a cada instancia upstream.
3. Verificar que la distribución es equitativa (~10 por instancia para 3 upstreams).

**Sub-prueba B — Sticky sessions (Collab LB, ip_hash):**
1. Conectar 3 clientes WebSocket desde la misma IP a `ws://localhost:8083`.
2. Verificar que los 3 son enrutados a la misma instancia (ip_hash).
3. Conectar 3 clientes desde IPs diferentes, verificar distribución entre instancias.

**Sub-prueba C — Failover (Collab LB):**
1. Con un cliente WebSocket conectado y estable, detener la instancia collab que lo atiende.
2. Medir el tiempo hasta que el cliente se reconecta a otra instancia.
3. Verificar que el estado del documento se recupera (vía poll sync o reconexión).

**Herramienta:** Script bash con `curl` + contador, `wscat` para WebSocket, `docker stop/kill` para simular caída de instancias.

**Referencia:** ADR-005. Fuente: `collab-load-balancer/nginx.config` (ip_hash, max_fails=3), `lsp-load-balancer/nginx.conf` (round-robin).

---

## 5. ADR-006 / ADR-012: Colaboración multiusuario

**Métrica:** 5 escenarios cualitativos con verificación visual y funcional. No se requiere medición numérica; se aprueba si todos los escenarios se comportan según lo esperado.

**Flujo básico:**

| Escenario | Procedimiento | Resultado esperado |
|---|---|---|
| **Concurrencia** | 3-4 usuarios autenticados en pestañas distintas abren el mismo proyecto | Los 3-4 nombres aparecen en la barra de colaboradores |
| **Sincronización de edición** | Usuario A escribe en el editor; usuarios B y C observan | El texto aparece en B y C en <2 segundos |
| **Cursores** | Cada usuario mueve su cursor a posiciones distintas | Los 3 cursores son visibles con colores distintos |
| **Propagación de cambios de archivo** | Usuario A crea/renombra/elimina un archivo | El cambio se refleja en B y C sin recargar la página (sin F5) |
| **Disponibilidad** | Los 4 usuarios permanecen editando durante 1 hora | No hay desconexiones, pérdida de contenido ni errores de sincronización |

**Herramienta:** Prueba manual con 3-4 pestañas de navegador abiertas simultáneamente. Verificación visual de la barra de colaboradores, los cursores en el editor y la lista de archivos en el sidebar.

**Referencia:** ADR-006, ADR-012. Fuente: `server.js` (Hocuspocus, `onAuthenticate`, `onAwarenessChange`), `collab.service.ts` (`connectProject`, observer de `Y.Array('files')`).

---

## 6. ADR-007: Servicio de lenguaje (LSP)

**Métrica:** Creación, consulta y destrucción de contenedores LSP exitosa; idle timeout funcional; distribución de carga equitativa.

**Flujo básico:**

1. **Crear contenedor LSP:** `POST /lsp/{project_id}` con `{language, max_clients}` → verificar respuesta 200 con `ws_url` y `container_id`.
2. **Consultar estado:** `GET /lsp/{project_id}` → verificar que retorna el estado del contenedor.
3. **Balanceo de carga:** Enviar 30 requests a `GET http://localhost:8085/health` y verificar distribución round-robin entre las instancias LSP upstream.
4. **Idle timeout:** Crear un contenedor, no enviar actividad durante >5 minutos (configurado en `CONTAINER_IDLE_TIMEOUT=300000`), verificar que el contenedor es destruido automáticamente.
5. **Destrucción manual:** `DELETE /lsp/{project_id}` → verificar que el contenedor Docker es eliminado.

**Herramienta:** Script bash con `curl` a los endpoints REST del LSP service (:8135) y al health del LSP load balancer (:8085).

**Referencia:** ADR-007. Fuente: `lifecycle.py` (`ContainerManager.create_container`, idle timeout), `lsp-load-balancer/nginx.conf`.

---

## Tabla resumen: ADR y requerimientos no funcionales

| ID | Descripción | Prueba asociada | Archivos fuente |
|---|---|---|---|
| **NF-001** | Disponibilidad ≥90% para escritura y ejecución de código en línea | §1 — Health polling 24h bajo carga | `server.ts`, `start-all.sh` |
| **NF-007** | Soporte de cientos de usuarios concurrentes ejecutando código | §2 — Carga concurrente WebSocket (50/100/200) | `containerPool.ts`, `dockeRunner.ts` |
| **NF-008** | Ejecución de código en contenedores aislados y restringidos | §3 — Verificación de sandboxing OWASP | `containerPool.ts` (`HostConfig`) |
| **ADR-001** | Entorno de ejecución seguro y aislado | §3 — Mismas pruebas que NF-008 | `containerPool.ts:50-67` |
| **ADR-004** | Autenticación basada en tokens (JWT) y control de acceso | §4 — Generación, extracción de rol, verificación | `settings.py` (`SIMPLE_JWT`), `views.py` |
| **ADR-005** | Balanceadores de carga para disponibilidad y desempeño | §5 — Distribución de carga + failover | `nginx.config`, `nginx.conf` |
| **ADR-006** | Manejo colaborativo multiusuario restringido | §6 — Concurrencia, conflictos, velocidades, disponibilidad | `server.js`, `collab.service.ts` |
| **ADR-007** | Diseño del servicio de lenguaje (LSP) | §7 — Contenedores LSP, idle timeout, balanceo | `lifecycle.py`, `lsp-load-balancer/nginx.conf` |
| **ADR-009** | Validación de credenciales de acceso | §4 — Token verification (mismas pruebas que ADR-004) | `views.py` (`ValidateCollabTokenView`) |
| **ADR-012** | Diseño del servicio de edición simultánea | §6 — Colaboración (mismas pruebas que ADR-006) | `server.js` (Hocuspocus), `documentStore.js` |

---

*Documento generado a partir del análisis del código fuente del repositorio — Plan de Pruebas v2.0*

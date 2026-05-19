# Plan de Pruebas — Sistema Colaborativo (v3.0)

## Ajustes de alcance

| Área | Ajuste aplicado |
|------|-----------------|
| Disponibilidad | Ventana de 2-6 horas (no 24h), carga simulada con Playwright para Python, resiliencia con auto-recovery ante caída total de instancias |
| Sandboxing | Simplificado a funcionalidad básica de ejecución (Python, C++, TypeScript) |
| Autenticación | Simplificada: solo login y verificación de identidad de usuario, sin control de acceso estricto |
| Colaboración | 100% automatizada con clientes WebSocket programáticos (Yjs + Hocuspocus) |
| LSP | Expandido: ciclo de vida, protocolo WebSocket, multiplexing, idle timeout reducido a 30s |
| Code execution | Solo ejecución básica, sin contenedores efímeros ni verificación OWASP |

---

## Fuentes de contexto

| Archivo | Información relevante para las pruebas |
|---|---|
| `code-execution-service/src/containerPool.ts` | Pool de 1 contenedor por lenguaje, `HostConfig` con límites de seguridad |
| `code-execution-service/src/dockeRunner.ts` | Timeout de ejecución 60s, polling cada 300ms, código vía variable de entorno base64 |
| `code-execution-service/src/server.ts` | WebSocket en puerto 8081, endpoint `GET /health`, cola de ejecución serializada |
| `backend/config/settings.py` | JWT HS256 con access token de 1h, refresh de 7d, collab de 2h |
| `backend/projects/views.py` | `collab_join` con límite de 4 usuarios; `ValidateCollabTokenView` |
| `backend/users/models.py` | Modelo `User` con campo `rol`, endpoints `/api/auth/login/`, `/api/auth/me/` |
| `collab-service/src/server.js` | Hocuspocus v2.15, autenticación por headers de gateway o JWT directo, awareness, poll sync cada 1s |
| `collab-load-balancer/nginx.config` | Balanceo `ip_hash`, 3 upstreams (:1234-1236), `auth_request /_auth`, `max_fails=3` |
| `lsp-load-balancer/nginx.conf` | Balanceo round-robin, 3 upstreams dinámicos, `fail_timeout=30s`, `update_nginx.py` |
| `LSP-Service/language-service/app/routers/lsp.py` | Endpoints REST: `POST/GET/DELETE /lsp/{project_id}`, `GET /lsp/`, `POST /lsp/cleanup` |
| `LSP-Service/language-service/app/services/lifecycle.py` | Contenedores LSP por proyecto+lenguaje, idle timeout, cross-machine forwarding |
| `LSP-Service/lsp-container/server.js` | Multiplexor LSP: WebSocket, session sharing, max_clients, idle auto-shutdown |
| `start-all.sh` | Orquestación de servicios, `JWT_SECRET` compartido, `ALLOWED_HOSTS`, `seed --force` |
| `frontend/src/app/services/collab.service.ts` | Cliente Angular: HocuspocusProvider, awareness, Y.Array('files') para archivos |
| `frontend/src/app/services/lsp-service.ts` | Cliente Angular: LSP via HTTP REST + WebSocket (initialize, didOpen, completion, diagnostics) |
| `PRUEBAS_API.md` | Pruebas de humo del API Gateway — complementa este plan (no lo reemplaza) |
| `monitor-lsp/monitor.py` | Patrones de monitor de disponibilidad y stress test reutilizables |

---

## Estructura de scripts a implementar

```
Proyecto_ARQ/tests/
├── smoke.sh                    # Health checks + operaciones básicas (CI/CD, ~30s)
├── availability.py             # Monitor de disponibilidad 2-6h + carga con Playwright
├── test_auth.py                # Autenticación JWT (simplificada: login, /me, token inválido)
├── test_execution.py           # Ejecución básica Python/C++/TypeScript vía WebSocket
├── test_lsp_rest.py            # CRUD de contenedores LSP (pytest)
├── test_lsp_ws.py              # Protocolo LSP vía WebSocket (pytest)
├── test_lsp_lifecycle.py       # Idle timeout (30s), max_clients, multiplexing
├── test_lb.py                  # Balanceadores: round-robin LSP, sticky collab, failover
├── test_resilience.py          # Resiliencia: caída total de instancias + auto-recovery
├── test_collab_ws.py           # Colaboración multiusuario automatizada (Yjs/Hocuspocus)
├── test_collab_filesync.py     # Propagación de archivos vía Y.Array('files')
└── utils/
    ├── lsp_ws_client.py        # Cliente WebSocket LSP reutilizable (handshake initialize/initialized)
    └── collab_ws_client.py     # Cliente Hocuspocus/Yjs reutilizable (autenticación, awareness)
```

---

## 1. Smoke Test — `tests/smoke.sh`

**Métrica:** 10 verificaciones, criterio de aprobación 100%. Ejecutable en CI/CD (~30 segundos).

**Flujo:**
1. `GET http://localhost:8081/health` → 200 `{"status":"ok"}` (code-execution)
2. `GET http://localhost:8083/health` → 200 `{"status":"ok","service":"collab-load-balancer"}` (collab LB)
3. `GET http://localhost:8085/health` → 200 `{"status":"ok","service":"lsp-load-balancer"}` (LSP LB)
4. `POST http://localhost:8000/api/auth/login/` con `{username, password}` → 200 con `{access, refresh}`
5. `GET http://localhost:8000/api/auth/me/` con `Authorization: Bearer <access>` → 200 con datos de usuario
6. `GET http://localhost:8000/api/projects/` con token → 200
7. `POST http://localhost:8085/lsp/smoke-test` con `{language: "python"}` → 200 con `ws_url`
8. `GET http://localhost:8085/lsp/smoke-test?language=python` → 200
9. `DELETE http://localhost:8085/lsp/smoke-test?language=python` → 200
10. `POST http://localhost:8083/dev-token` → 200 con `{token}`

**Herramienta:** Script bash con `curl`, conteo PASS/FAIL, código de salida ≠0 si algún check falla.

**Referencia:** `PRUEBAS_API.md` (pruebas de humo existentes), `server.ts` (:8081/health), `nginx.config` (:8083/health), `nginx.conf` (:8085/health).

---

## 2. ASR-001 / NF-001: Limitaciones de disponibilidad de escritura y ejecución en línea

**Métrica:** Tasa de éxito de health checks y operaciones sobre ventana de 2-6 horas. Objetivo ≥90% de respuestas exitosas bajo carga simulada con navegador real. Incluye pruebas de resiliencia ante caída total de instancias con recuperación automática.

### 2.1 Health polling (capa API)

**Health polling:** sondeo periódico de salud. Consiste en consultar los endpoints `/health` de cada servicio cada N segundos (ej. 30s) durante una ventana larga (2-6h), registrando éxitos, fallos y latencia. Al final se calcula: `% disponible = (peticiones_exitosas / total_peticiones) × 100`.

**Flujo:**
1. Iniciar todos los servicios vía `start-all.sh`.
2. Ejecutar script `availability.py` que cada 30 segundos consulte los health checks:
   - `GET http://localhost:8083/health` (collab LB)
   - `GET http://localhost:8085/health` (LSP LB)
   - `POST http://localhost:8000/api/auth/login/` con credenciales válidas (backend)
3. Registrar éxitos, fallos y latencia en archivo JSON (`results/availability_<timestamp>.json`).
4. Al finalizar, calcular tasa de disponibilidad por servicio y global.

### 2.2 Carga simulada con Playwright (capa UI)

**Propósito:** Simular usuarios reales interactuando con la UI para medir disponibilidad extremo-a-extremo, no solo health checks de API.

 **Flujo:**
1. Paralelamente al health polling, ejecutar 2-3 instancias de Playwright (Python) en headless mode.
2. Cada instancia Playwright ejecuta un ciclo cada 60 segundos:
   - Abrir `http://localhost:4200` (frontend Angular).
   - Iniciar sesión con credenciales de prueba (`POST /api/auth/login/` vía `page.evaluate()` o `request`).
   - Navegar al editor de un proyecto de prueba.
   - Verificar que el editor CodeMirror carga (esperar selector `.cm-editor`).
   - Escribir una línea de código en el editor y verificar que aparece.
   - **Probar autocompletado LSP:** posicionar el cursor al final de una línea con un prefijo conocido (ej. `pr` en Python), presionar `Ctrl+Space` para invocar autocompletado, y verificar que el popup de sugerencias aparece (selector `.cm-tooltip-autocomplete` o similar) con al menos un item (ej. `print`).
   - Ejecutar código vía botón de ejecución (si aplica) o verificar que el panel de salida responde.
   - Cerrar sesión.
3. Registrar éxito/fallo y latencia de cada paso (login, carga de editor, escritura, autocompletado, ejecución, cierre de sesión) y capturas de pantalla en fallos.
4. La tasa de disponibilidad final combina métricas de API + UI: `éxitos_ui / total_intentos_ui × 100`. El paso de autocompletado se reporta como métrica independiente para medir la disponibilidad del LSP bajo carga.

**Herramienta:** Python 3 con `playwright` (`pip install playwright`, `playwright install chromium`). Reutiliza patrones de `monitor.py` (clase `Stats`, percentile, reporte JSON).

**Uso:** `python3 tests/availability.py --duration 4h --interval 30 --playwright-workers 3`

**Referencia:** NF-001. Fuente: `server.ts` (health endpoint), `start-all.sh`, `frontend/src/app/editor/`, `frontend/src/app/services/lsp-service.ts` (autocompletado), `frontend/src/app/services/codemirror-lsp-service.ts`, `monitor.py` (patrones reutilizables).

### 2.3 Resiliencia ante caída total de instancias (auto-recovery)

**Propósito:** Verificar que el sistema es capaz de detectar la caída total de todas las instancias de un servicio y recuperarse automáticamente levantando nuevas instancias, sin intervención manual.

**Contexto:** Si todas las réplicas de un servicio (LSP, collab) fallan simultáneamente, el balanceador de carga u otro componente de orquestación debe detectar la ausencia total de backends sanos y disparar el reinicio o reemplazo de las instancias caídas.

**Precondición:** El sistema debe contar con un mecanismo de auto-recovery (health check del balanceador + script de reinicio, Docker Compose con `restart: always` + healthcheck, o supervisor de procesos). Si el entorno de pruebas no dispone de orquestación automática, se debe implementar un script `recovery-watchdog.sh` que monitoree los upstreams del balanceador y reinicie las instancias caídas.

#### Escenarios

| # | Escenario | Procedimiento | Resultado esperado |
|---|-----------|--------------|--------------------|
| **R1** | **Caída total de instancias LSP** | 1. Verificar que las 3 instancias LSP están sanas (`GET /health` a cada upstream). 2. Detener simultáneamente las 3 instancias (`docker stop lsp-<puerto>` para todas). 3. Monitorear el balanceador LSP (`GET http://localhost:8085/health`) cada 5s durante 60s. 4. Verificar que el mecanismo de auto-recovery detecta la caída y levanta nuevas instancias. | El balanceador responde inicialmente con error 502/503 (sin backends). En ≤30s, el mecanismo de recovery levanta al menos 1 nueva instancia. El health del LB vuelve a 200. Las nuevas instancias aceptan requests LSP (`POST /lsp/{id}` → 200). |
| **R2** | **Caída total de instancias Collab** | 1. Verificar que las 3 instancias collab están sanas. 2. Detener simultáneamente las 3 instancias (`docker stop collab-<puerto>`). 3. Monitorear `GET http://localhost:8083/health` cada 5s. 4. Esperar auto-recovery. | Similar a R1: 502/503 inicial, recovery en ≤30s, health vuelve a 200, nuevas instancias aceptan WebSocket con token válido. |
| **R3** | **Recuperación con estado** | 1. Crear un contenedor LSP para `project:test-recovery` (lenguaje Python). 2. Conectar cliente WS y hacer `didOpen` de `main.py`. 3. Detener las 3 instancias LSP. 4. Esperar auto-recovery. 5. Intentar crear nuevamente el contenedor y conectar otro cliente. | Tras recovery, el sistema está limpio y funcional. El nuevo contenedor se crea exitosamente y acepta sesiones LSP. Los clientes previamente conectados deben reconectarse (failover vía balanceador). |
| **R4** | **Disponibilidad ≥90% durante recuperación** | 1. Ejecutar health polling (§2.1) durante 1 hora con intervalos de 10s. 2. A los 20 min, provocar caída total de LSP (R1). 3. A los 40 min, provocar caída total de Collab (R2). 4. Calcular tasa de disponibilidad global. | La tasa de disponibilidad combinada (API + UI) se mantiene ≥90% a pesar de los incidentes de caída total, gracias a la recuperación automática en ≤30s. |
| **R5** | **Balanceador de carga como health-check watchdog** | 1. Verificar que el balanceador LSP (`nginx.conf`) tiene `fail_timeout=30s` y `max_fails`. 2. Detener 1 instancia. 3. Verificar que el balanceador la marca como `down` tras `max_fails` intentos fallidos. 4. Reactivar la instancia. 5. Verificar que el balanceador la reincorpora al pool tras `fail_timeout`. | El balanceador excluye automáticamente instancias no saludables y las reincorpora cuando se recuperan, sin necesidad de recarga manual de configuración. |

**Herramienta:** `tests/test_resilience.py` — pytest + `subprocess` para `docker stop`/`docker start`, `httpx` para health polling, `time` para medir tiempos de recuperación. Alternativamente, script bash `tests/resilience.sh` si la orquestación es vía shell scripts.

**Uso:** `python3 tests/test_resilience.py --services lsp,collab --watchdog-script ./recovery-watchdog.sh`

**Referencia:** ASR-001, NF-001. Fuente: `lsp-load-balancer/nginx.conf` (fail_timeout), `collab-load-balancer/nginx.config` (max_fails), `update_nginx.py` (actualización dinámica de upstreams), `start-all.sh` (orquestación de servicios).

---

## 3. ADR-004 / ADR-009: Autenticación JWT (simplificada)

**Métrica:** 3 sub-pruebas, criterio de aprobación 100%.

**Contexto:** La autenticación no es para control de acceso estricto, sino para diferenciar usuarios en el editor colaborativo (nombre, color de cursor). Las pruebas se enfocan en la generación y validación básica de tokens.

| Sub-prueba | Procedimiento | Resultado esperado |
|---|---|---|
| **Login válido** | `POST /api/auth/login/` con `{username: "samuel", password: "User1234!"}` | 200 con `{access, refresh}`. El payload JWT decodificado contiene `user_id` y `username`. |
| **Perfil de usuario** | `GET /api/auth/me/` con `Authorization: Bearer <access>` | 200 con `{id, username, email, rol}`. El campo `username` identifica al usuario para el editor. |
| **Tokens inválidos** | `GET /api/auth/me/` con: token expirado, firma alterada, sin token, token vacío | 401 en todos los casos |

**Herramienta:** `tests/test_auth.py` — script Python con `requests` + `jwt`/`base64` para decodificar payloads.

**Referencia:** ADR-004, ADR-009. Fuente: `settings.py` (`SIMPLE_JWT`), `views.py` (`ValidateCollabTokenView`), `models.py` (`User`).

---

## 4. Ejecución de código (funcionalidad básica)

**Métrica:** 3 lenguajes × 2 escenarios (éxito, timeout) = 6 pruebas. Criterio de aprobación 100%.

**Contexto:** El code-execution-service mantiene un contenedor persistente por lenguaje (no efímero). Las pruebas verifican que el código se ejecuta, produce output y maneja timeouts correctamente.

| Test | Código de prueba | Resultado esperado |
|---|---|---|
| **Python: hello world** | `print("hola mundo")` | `type: "output"` → `"hola mundo\n"`, `type: "finished"` → `exitCode: 0` |
| **Python: timeout** | `while True: pass` | `type: "timeout"` después de 60s |
| **C++: hello world** | `#include <iostream>\nint main(){std::cout<<"hola";return 0;}` | `type: "output"` → `"hola"`, `exitCode: 0` |
| **C++: compile error** | `int main(){return foo;}` | `type: "output"` con mensaje de error de compilación, `exitCode ≠ 0` |
| **TypeScript: hello world** | `console.log("hola ts");` | `type: "output"` → `"hola ts\n"`, `exitCode: 0` |
| **Ejecución concurrente** | Enviar 3 requests Python seguidos sin esperar | Respuestas serializadas (una tras otra), cada una con su `finished` |

**Herramienta:** `tests/test_execution.py` — script Python con `websocket-client` (`pip install websocket-client`). Conectar a `ws://localhost:8081/ws/execute`, enviar `{type: "run", language, code}`, recibir mensajes hasta `finished`/`timeout`/`error`.

**Referencia:** `server.ts` (WebSocket protocol), `dockeRunner.ts` (timeout 60s), `containerPool.ts` (serial queue).

---

## 5. ADR-007: Servicio de lenguaje (LSP) — Prueba REST

**Métrica:** 9 tests automatizados (pytest). Criterio de aprobación 100%.

### 5.1 CRUD de contenedores — `tests/test_lsp_rest.py`

| Test | Procedimiento | Esperado |
|------|--------------|----------|
| `test_create_container_python` | `POST /lsp/{id}` con `{language: "python", max_clients: 4}` | 200, `ws_url` comienza con `ws://`, `container_id` no vacío, `host` presente |
| `test_create_container_cpp` | `POST /lsp/{id}` con `{language: "cpp"}` | 200, `ws_url` válido |
| `test_create_container_typescript` | `POST /lsp/{id}` con `{language: "typescript"}` | 200, `ws_url` válido |
| `test_unsupported_language` | `POST /lsp/{id}` con `{language: "java"}` | 400 |
| `test_missing_language` | `POST /lsp/{id}` con `{}` | 400 o 422 |
| `test_get_status` | `GET /lsp/{id}?language=python` tras crear | 200, estado del contenedor con `container_id`, `ws_url`, `language` |
| `test_list_all` | `GET /lsp/` con ≥1 contenedor activo | 200, `{total: N, containers: [...]}` con N ≥ 1 |
| `test_idempotent_create` | `POST /lsp/{id}` 2 veces con mismo proyecto+lenguaje | Ambas retornan 200 con el mismo `container_id` |
| `test_destroy` | `DELETE /lsp/{id}?language=python` | 200, consulta posterior → `status: "not_found"` |

**Herramienta:** `tests/test_lsp_rest.py` — pytest + `httpx` (mismo stack que `test_multi_machine.py` existente). Apunta al balanceador LSP en `http://localhost:8085`. Fixture `autouse` para limpiar contenedores creados durante las pruebas.

### 5.2 Protocolo LSP vía WebSocket — `tests/test_lsp_ws.py`

| Test | Procedimiento | Esperado |
|------|--------------|----------|
| `test_initialize` | Conectar WS, enviar `initialize` con capabilities | Respuesta `{id, result: {capabilities}}` |
| `test_did_open` | `textDocument/didOpen` con contenido Python al URI `file:///workspace/main.py` | Sin error |
| `test_completion` | `didOpen` + `textDocument/completion` en posición conocida | Array de CompletionItems con `label` |
| `test_hover` | `didOpen` + `textDocument/hover` sobre `print` | `result.contents` con documentación |
| `test_definition` | `didOpen` + `textDocument/definition` sobre una función | `result` con URI y rango |
| `test_diagnostics` | `didOpen` con código con error → esperar `textDocument/publishDiagnostics` | Notificación con `diagnostics[]` no vacío |
| `test_did_change` | `didOpen` + `textDocument/didChange` con contenido modificado | Sin error, diagnósticos actualizados |
| `test_did_close` | `didOpen` + `textDocument/didClose` | Sin error |

**Herramienta:** `tests/test_lsp_ws.py` — pytest + `utils/lsp_ws_client.py` (cliente reutilizable que encapsula el handshake LSP: `initialize` → `initialized`, correlación request/response vía `id`, timeouts de 5s).

**Flujo del cliente reutilizable (`utils/lsp_ws_client.py`):**
1. `connect(ws_url)` → abre WebSocket
2. `initialize()` → envía `initialize` + espera respuesta + envía `initialized`
3. `open_document(uri, language, content)` → `textDocument/didOpen`
4. `request(method, params)` → envía request con `id` único, espera respuesta con mismo `id` (timeout 5s)
5. `wait_for_notification(method, timeout)` → espera notificación específica (ej. `publishDiagnostics`)
6. `close()` → cierra WebSocket

### 5.3 Ciclo de vida — `tests/test_lsp_lifecycle.py`

**Configuración:** `CONTAINER_IDLE_TIMEOUT=30000` (30 segundos para pruebas, en lugar de 5 minutos).

| Test | Procedimiento | Esperado |
|------|--------------|----------|
| `test_idle_timeout_destroys_container` | Crear contenedor, conectar WS, inicializar LSP, desconectar WS. Esperar 35s. Consultar estado. | `status: "not_found"` |
| `test_activity_resets_idle_timer` | Crear contenedor, conectar WS, enviar `didChange` cada 10s durante 40s. | Contenedor sigue activo al final |
| `test_max_clients_enforced` | Crear contenedor con `max_clients: 2`. Conectar cliente 1 (OK). Conectar cliente 2 (OK). Conectar cliente 3. | Cliente 3 rechazado con close code 1013 |
| `test_multiplexing_different_files` | 2 clientes conectados al mismo contenedor. Cliente A abre `a.py`, Cliente B abre `b.py`. Ambos reciben `publishDiagnostics` independientes. | Diagnósticos separados por URI, sin interferencia |
| `test_multiplexing_same_file` | 2 clientes conectados. Ambos abren `main.py`. Cliente A modifica → `didChange`. | Cliente B recibe diagnósticos actualizados para `main.py` |

**Herramienta:** `tests/test_lsp_lifecycle.py` — pytest + `utils/lsp_ws_client.py`. Requiere Docker accesible para verificar estado de contenedores.

**Referencia:** ADR-007. Fuente: `lifecycle.py` (create/destroy), `lsp.py` (endpoints REST), `server.js` (LSP multiplexor: `scheduleShutdown`, `max_clients`, session sharing).

---

## 6. ADR-006 / ADR-012: Colaboración multiusuario automatizada

**Métrica:** 7 escenarios automatizados con clientes WebSocket programáticos. Criterio de aprobación 100%.

**Contexto:** Las pruebas usan `yjs` + `y-websocket` (o `@hocuspocus/provider`) en Node.js para simular múltiples clientes conectados al mismo documento colaborativo. Cada cliente tiene su propio `Y.Doc`, awareness state, y nombre de usuario.

### 6.1 Cliente reutilizable — `utils/collab_ws_client.py`

Encapsula la conexión Hocuspocus/Yjs:
1. Obtener token JWT vía `POST /dev-token` o `POST /api/auth/login/`
2. Crear `Y.Doc` con `Y.Text('codemirror')`
3. Conectar vía `HocuspocusProvider` a `ws://localhost:8083?token=<JWT>` con `name=<room>`
4. Esperar eventos: `onConnect`, `onSynced`, `onAwarenessUpdate`, `onDisconnect`, `onAuthenticationFailed`
5. Leer/escribir `Y.Text`, leer awareness states
6. Desconectar limpiamente

**Implementación:** Node.js con `yjs`, `@hocuspocus/provider`, `ws`. Se invoca desde Python o directamente con Node.js. Alternativa: Python con `y-py` (bindings nativos de Yrs para Python, más ligero).

### 6.2 Escenarios de prueba — `tests/test_collab_ws.py`

| Test | Procedimiento | Esperado |
|------|--------------|----------|
| **Conexión y autenticación** | 1 cliente se conecta con token JWT válido al room `test-collab` | Evento `onConnect` disparado, `onSynced` en <5s |
| **Auth fallida** | 1 cliente intenta conectar sin token o con token inválido | Evento `onAuthenticationFailed` con `reason` |
| **Persistencia de documento** | Cliente A conecta, inserta texto "Hola mundo", desconecta. Cliente B conecta al mismo room. | Cliente B recibe el documento con "Hola mundo" |
| **Edición concurrente (2 usuarios)** | Cliente A y B conectados. A inserta texto. B verifica. Luego B inserta, A verifica. | Ambos ven el texto del otro en <2s |
| **Awareness (cursores + presencia)** | 3 clientes conectados. A escribe, mueve cursor. B y C observan. | `onAwarenessUpdate` en B y C contiene los 3 usuarios con nombres y colores |
| **Desconexión y limpieza** | 3 clientes conectados. Cliente A desconecta. | B y C reciben awareness update sin A (solo 2 usuarios restantes) |
| **Límite de 4 usuarios** | Conectar 4 clientes al room `test-collab` (OK). Intentar conectar un 5to. | El 5to es rechazado o el servidor retorna error de sala llena |

### 6.3 Propagación de archivos — `tests/test_collab_filesync.py`

**Contexto:** El frontend usa `Y.Array('files')` en un Y.Doc a nivel de proyecto para sincronizar creación/renombrado/eliminación de archivos entre colaboradores.

| Test | Procedimiento | Esperado |
|------|--------------|----------|
| **Crear archivo** | Cliente A conecta al room `project:123`. A inserta `[{nombre: "main.py", id: 1}]` en `Y.Array('files')`. | Cliente B (mismo room) recibe el array con el nuevo archivo en <2s |
| **Renombrar archivo** | A renombra `main.py` → `app.py` vía marcador `{_op: "rename", id: 1, nombre: "app.py"}` | B recibe el marcador y ve el archivo renombrado |
| **Eliminar archivo** | A elimina el archivo id=1 vía marcador `{_op: "delete", id: 1}` | B recibe el marcador y el archivo desaparece de la lista |

**Herramienta:** `tests/test_collab_filesync.py` — mismo cliente reutilizable, pero usando `Y.Array('files')` en lugar de `Y.Text('codemirror')`.

**Referencia:** ADR-006, ADR-012. Fuente: `server.js` (Hocuspocus, `onAuthenticate`, `onConnect`, `onDisconnect`, `onLoadDocument`, poll sync), `collab.service.ts` (`connectProject`, `getProjectFilesArray`, `pushProjectFile`, `deleteProjectFile`, `renameProjectFile`).

---

## 7. ADR-005: Balanceadores de carga

**Métrica:** Distribución de requests con desviación <20% de la media y failover <30s.

### 7.1 LSP Load Balancer (round-robin) — `tests/test_lb.py`

| Test | Procedimiento | Esperado |
|------|--------------|----------|
| **Distribución round-robin** | Enviar 30 requests a `GET http://localhost:8085/health` | ~10 por instancia (3 upstreams), desviación <20% |
| **Failover LSP** | Detener una instancia upstream (`docker stop lsp-service-8136`). Enviar 15 requests. | Nginx enruta solo a las 2 sanas. Tras 30s (fail_timeout), la instancia caída sale del upstream. Reactivar instancia → vuelve al pool. |
| **Health LB responde** | `GET http://localhost:8085/health` durante el failover | Siempre 200, sin degradación |

### 7.2 Collab Load Balancer (ip_hash) — `tests/test_lb.py`

| Test | Procedimiento | Esperado |
|------|--------------|----------|
| **Sticky sessions (misma IP)** | Conectar 3 clientes WebSocket desde localhost al room `sticky-test` | Los 3 son enrutados a la misma instancia (mismo `X-Instance-Port`) |
| **Failover collab** | Conectar cliente WS, esperar `onSynced`. Detener la instancia collab que lo atiende (`docker stop collab-1234`). Medir tiempo hasta reconexión. | Cliente se desconecta, intenta reconectar. Nginx enruta a otra instancia. Tiempo de failover <30s. |
| **Recuperación de documento post-failover** | Antes del failover, cliente A inserta texto. Tras failover a otra instancia, cliente B (ya conectado a instancia sana) verifica el texto. | El poll sync (1s) propaga el documento a la instancia sana antes del failover. B ve el texto de A. |

**Herramienta:** `tests/test_lb.py` — pytest, combina `curl` vía `subprocess` + cliente WebSocket de colaboración. Usa `docker stop`/`docker start` para simular caídas.

**Referencia:** ADR-005. Fuente: `collab-load-balancer/nginx.config` (ip_hash, max_fails=3, auth_request), `lsp-load-balancer/nginx.conf` (round-robin, fail_timeout=30s), `server.js` (poll sync cada 1s).

---

## Tabla resumen: ADR y requerimientos no funcionales

| ID | Descripción | Prueba asociada | Archivos fuente |
|---|---|---|---|
| **ASR-001 / NF-001** | Disponibilidad ≥90% para edición y colaboración en línea, con resiliencia ante caída total de instancias y recuperación automática | §2 — Health polling 2-6h + carga Playwright + resiliencia auto-recovery | `server.ts`, `start-all.sh`, `app/editor/`, `nginx.conf`, `update_nginx.py` |
| **ADR-004** | Autenticación basada en tokens (JWT) para identificar usuarios | §3 — Login, perfil, tokens inválidos | `settings.py`, `views.py` |
| **ADR-005** | Balanceadores de carga para disponibilidad y desempeño | §7 — Distribución + failover LSP y Collab | `nginx.config`, `nginx.conf` |
| **ADR-006** | Manejo colaborativo multiusuario restringido (≤4) | §6.2 — Conexión, edición concurrente, awareness, límites | `server.js`, `collab.service.ts` |
| **ADR-007** | Diseño del servicio de lenguaje (LSP) | §5 — REST CRUD, WS protocolo, ciclo de vida, multiplexing | `lifecycle.py`, `lsp.py`, `server.js` (LSP multiplexor) |
| **ADR-009** | Validación de credenciales de acceso | §3 — Token verification (mismas pruebas que ADR-004) | `views.py` (`ValidateCollabTokenView`) |
| **ADR-012** | Diseño del servicio de edición simultánea | §6 — Colaboración (mismas pruebas que ADR-006) | `server.js` (Hocuspocus), `documentStore.js` |
| **NF-008** | Ejecución de código funcional | §4 — Ejecución básica Python/C++/TS + timeout | `containerPool.ts`, `dockeRunner.ts` |

---

## Dependencias de herramientas

### Python (tests/)
```
pip install pytest httpx websocket-client requests pyyaml playwright
playwright install chromium
```

### Node.js (utils/collab_ws_client.py — alternativa con y-py o subprocess a script Node.js)
```
npm install yjs @hocuspocus/provider ws
```

### Bash (smoke.sh)
- `curl`, `jq` (sistema)

---

## Criterios de aceptación globales (Go/No-Go)

| # | Criterio | Umbral |
|---|----------|--------|
| 1 | Smoke test | 10/10 checks pasan en <60s |
| 2 | Disponibilidad (health + Playwright + resiliencia) | ≥90% en ventana 2-6h |
| 3 | Resiliencia auto-recovery | Recuperación en ≤30s tras caída total |
| 4 | LSP REST CRUD | 9/9 tests pasan |
| 5 | LSP WebSocket protocolo | 8/8 tests pasan |
| 6 | LSP ciclo de vida | 5/5 tests pasan (idle=30s) |
| 7 | Colaboración WebSocket | 7/7 tests pasan |
| 8 | Propagación de archivos | 3/3 tests pasan |
| 9 | Balanceadores carga + failover | Distribución <20% desviación, failover <30s |
| 10 | Ejecución de código | 6/6 tests pasan |
| 11 | Autenticación JWT | 3/3 tests pasan |

---

## Scripts existentes reutilizables

| Script | Ubicación | Qué aporta |
|--------|-----------|------------|
| `test_collab_lb.sh` | `collab-load-balancer/` | Health, token, sticky, WebSocket — base para smoke.sh y test_lb.py |
| `prueba_real_lsp.py` | `LSP-Service/tests/` | Stress + monitor + failover LSP — base para availability.py y test_lb.py |
| `test_multi_machine.py` | `LSP-Service/tests/` | pytest + httpx para LSP CRUD cross-machine — patrón para test_lsp_rest.py |
| `test_clients.py` / `persistent_client.py` | `LSP-Service/tests/` | Cliente WebSocket LSP persistente — base para utils/lsp_ws_client.py |
| `monitor.py` | `monitor-lsp/` | Monitor de disponibilidad + stress test — base para availability.py |
| `PRUEBAS_API.md` | raíz | Comandos curl de smoke test — referencia para smoke.sh |

---

## Cronograma de implementación sugerido (2 semanas)

| Día | Tarea |
|-----|-------|
| 1 | `smoke.sh` + `test_auth.py` (simples, validan que el entorno funciona) |
| 2 | `utils/lsp_ws_client.py` (cliente LSP reutilizable) |
| 3 | `test_lsp_rest.py` (CRUD de contenedores vía balanceador) |
| 4 | `test_lsp_ws.py` (protocolo LSP: initialize, completion, hover, diagnostics) |
| 5 | `test_lsp_lifecycle.py` (idle timeout 30s, max_clients, multiplexing) |
| 6 | `test_execution.py` (ejecución básica Python/C++/TS) |
| 7 | `utils/collab_ws_client.py` (cliente Hocuspocus/Yjs reutilizable) |
| 8 | `test_collab_ws.py` (conexión, edición concurrente, awareness, límite 4) |
| 9 | `test_collab_filesync.py` (Y.Array propagación de archivos) |
| 10 | `test_lb.py` (balanceadores LSP + collab, failover) |
| 11 | `test_resilience.py` (caída total + auto-recovery) |
| 12 | `availability.py` (health polling + carga Playwright, reporte JSON) |
| 13 | Integración, CI/CD, documentación de resultados |

---

*Documento generado a partir del análisis del código fuente del repositorio — Plan de Pruebas v3.0*

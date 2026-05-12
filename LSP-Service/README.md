# USO DEL SERVIDOR DE LENGUAJE (API)

Este servicio expone un API HTTP (FastAPI) que crea y destruye contenedores Docker con el LSP correspondiente (python/cpp/typescript).

## Requisitos
- Python 3.10+
- Docker Engine con acceso al socket
- Node.js 20+ (para construir la imagen)


### Docker (daemon + permisos)

En Linux con systemd:

```
sudo systemctl enable --now docker.socket
sudo systemctl enable --now docker.service
```

Permisos para usar Docker sin `sudo`:

```
sudo usermod -aG docker $USER
newgrp docker  # o cierra sesión y vuelve a entrar
docker ps
```

## 1) Construir la imagen del contenedor LSP

El API usa la imagen local `lsp-server:latest` (no hace pull).

```
cd lsp-container
docker build -t lsp-server:latest .
```

Si `docker images` muestra la imagen pero el API dice que no existe, revisa que estés usando el mismo Docker daemon/context:

```
docker context show
```

## 2) Instalar dependencias del API

```
pip3 install -r require.txt
```

### 3) Configurar Variables de Entorno

Modificar archivo `.env` en `language-service/`:

```bash
PROJECTS_DIR=/home/$USER/projects
WS_PUBLIC_HOST=127.0.0.1
CONTAINER_IDLE_TIMEOUT=300000
MAX_CLIENTS_PER_CONTAINER=4
```

## 4) Arrancar el servidor

```
cd language-service
python3 -m uvicorn app.main:app --reload --port 8135
```

### Linux
** Importante para que se conecte al API Gateway **
127.0.0.1 (localhost) es un loopback exclusivo del contenedor/namespace. Cuando un contenedor Docker intenta conectarse a host.docker.internal:8135, en realidad necesita acceder al IP del host real, no al loopback.
```
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8135
```


## Peticiones de ejemplo

Crear contenedor LSP:

```
curl -X POST http://127.0.0.1:8135/lsp/proyecto-1 \
  -H "Content-Type: application/json" \
  -d '{"language": "python"}'
```

Consultar estado:

```
curl http://127.0.0.1:8135/lsp/proyecto-1
```

Eliminar contenedor:

```
curl -X DELETE http://127.0.0.1:8135/lsp/proyecto-1
```

## Volumen del proyecto (workspace)

Por defecto se monta `${PROJECTS_DIR:-~/projects}/<project_id>` en el contenedor como `/workspace`.

Si el servicio corre como otro usuario (p. ej. root/systemd), configura `PROJECTS_DIR` para fijar la ruta base:

```
export PROJECTS_DIR=/home/simondm/projects
```

# USO DEL CONTENEDOR DEL LSP (manual)

El propósito de usar el contenedor manualmente es solo para probar su funcionamiento; en operación normal debe ser controlado por el API.

**Python (TCP 2087)**

```
docker run --rm -e LANGUAGE=python -p 2087:2087 lsp-server:latest
```

**C++**

```
docker run --rm -it -e LANGUAGE=cpp lsp-server:latest
```

**Typescript**

```
docker run --rm -it -e LANGUAGE=typescript lsp-server:latest
```

## Pruebas (ps + grep) dentro del contenedor

En otra terminal, obtén el ID del contenedor:

```
docker ps
```

Y valida el proceso según el lenguaje:

**Python**

```
docker exec <ID_CONTENEDOR> bash -lc "ps aux | grep -E '[p]ylsp'"
```

**C++**

```
docker exec <ID_CONTENEDOR> bash -lc "ps aux | grep -E '[c]langd'"
```

**Typescript**

```
docker exec <ID_CONTENEDOR> bash -lc "ps aux | grep -E '[t]ypescript-language-server|[n]ode.*typescript-language-server'"
```

## 📁 Estructura del Proyecto

```
LSP-Service/
├── language-service/           # API FastAPI para gestión de contenedores
│   ├── app/
│   │   ├── main.py            # Punto de entrada de la API
│   │   ├── routers/
│   │   │   └── lsp.py         # Endpoints REST
│   │   └── services/
│   │       ├── lifecycle.py   # Gestión de contenedores Docker
│   │       └── registry.py    # Registro en memoria de contenedores activos
│   └── .env                   # Variables de entorno (WS_PUBLIC_HOST, PROJECTS_DIR)
├── lsp-container/              # Imagen Docker del multiplexor LSP
│   ├── Dockerfile             # Definición de la imagen
│   ├── entrypoint.sh          # Script de entrada
│   ├── package.json           # Dependencias Node.js
│   ├── server.js              # Multiplexor WebSocket → LSP
│   └── config/
│       └── lsp-servers.js     # Configuración de lenguajes soportados
└── tests/                     # Scripts de prueba
    ├── persistent_client.py   # Cliente persistente reutilizable
    ├── test_clients.py        # Script principal de pruebas
    ├── test_single_client.py  # Cliente interactivo manual
    └── test_conect_limits.sh  # Prueba de límites de conexiones
```

## 📡 Endpoints de la API

### Crear Contenedor LSP

```bash
POST /lsp/{project_id}
Content-Type: application/json

{
    "language": "python",     # python | cpp | typescript
    "max_clients": 4          # opcional, default: 4
}
```

**Respuesta:**
```json
{
    "message": "Contenedor LSP creado exitosamente (máx 4 clientes)",
    "project_id": "test-project",
    "container_id": "1c9a1d4353db",
    "language": "python",
    "ws_url": "ws://127.0.0.1:32768",
    "ws_port": 32768,
    "max_clients": 4
}
```

### Consultar Estado

```bash
GET /lsp/{project_id}
```

### Listar Contenedores Activos

```bash
GET /lsp/
```

### Eliminar Contenedor

```bash
DELETE /lsp/{project_id}
```

### Ver Logs del Contenedor

```bash
GET /lsp/{project_id}/logs?tail=100
```

### Limpiar Contenedores Inactivos

```bash
POST /lsp/cleanup?idle_timeout=1800
```
## Monitoreo contenedor

# 1. Ver logs del contenedor (follow mode)
docker logs -f nombre_del_contenedor

# 2. Ver logs con timestamps
docker logs -t nombre_del_contenedor

# 3. Ver últimos N líneas
docker logs --tail 100 nombre_del_contenedor

# 4. Ver logs con detalles adicionales
docker logs --details nombre_del_contenedor

### Recursos

# 5. Estadísticas de CPU/Memoria del contenedor
docker stats nombre_del_contenedor

# 6. Todos los contenedores LSP
docker stats --filter "name=lsp"

# 7. Ver procesos dentro del contenedor
docker exec nombre_del_contenedor ps aux

# 8. Ver procesos LSP específicos
docker exec nombre_del_contenedor ps aux | grep -E "pylsp|clangd|typescript"

## 🧪 Pruebas

### Scripts de Prueba Disponibles

| Script | Propósito |
|--------|-----------|
| `test_single_client.py` | Cliente interactivo para pruebas manuales |
| `test_clients.py` | Script principal con modos `-p` (persistente), `-e` (extra), `-m` (múltiple) |
| `test_conect_limits.sh` | Prueba automatizada de límites de conexiones |

### Ejemplos de Uso

```bash
cd tests/

# Cliente interactivo (modo manual con menú)
python3 test_single_client.py ws://127.0.0.1:32768

# Cliente persistente individual
python3 test_clients.py -p 32768 1

# Probar conexión extra (verificar límite)
python3 test_clients.py -e 32768

# Lanzar múltiples clientes persistentes
python3 test_clients.py -m 32768 4

# Prueba completa de límites
./test_conect_limits.sh 32768 4
```

### Prueba Rápida con cURL

```bash
# Crear contenedor
curl -X POST http://localhost:8135/lsp/test-project \
  -H "Content-Type: application/json" \
  -d '{"language": "python", "max_clients": 4}'

# Conectar vía WebSocket (usar ws_url de la respuesta)
wscat -c ws://127.0.0.1:32768

# Enviar mensajes LSP
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":"file:///workspace","capabilities":{}}}
{"jsonrpc":"2.0","method":"initialized","params":{}}
{"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///workspace/test.py","languageId":"python","version":1,"text":"import os\nos.path."}}}
{"jsonrpc":"2.0","id":2,"method":"textDocument/completion","params":{"textDocument":{"uri":"file:///workspace/test.py"},"position":{"line":1,"character":8}}}
```


## 🔧 Lenguajes Soportados

| Lenguaje | Servidor LSP | Comando | Puerto |
|----------|-------------|---------|--------|
| Python | `pylsp` | `pylsp` | 3000 |
| C++ | `clangd` | `clangd --compile-commands-dir=/workspace` | 3000 |
| TypeScript | `typescript-language-server` | `typescript-language-server --stdio` | 3000 |

## 📊 Características Principales

- **Multiplexor WebSocket**: Un solo puerto expuesto (3000) maneja hasta 4 clientes concurrentes
- **Instancia LSP compartida**: Todos los clientes comparten el mismo proceso LSP
- **Aislamiento por proyecto**: Un contenedor por `project_id`
- **Mapeo dinámico de puertos**: El host asigna puertos aleatorios automáticamente
- **Limpieza automática**: Contenedores inactivos se detienen tras timeout configurable
- **Traducción de rutas**: Manejo automático de `file:///workspace` ↔ `/workspace`

# Conexión con el Frontend

## 📋 Descripción General

El frontend de la aplicación se conecta con el **Servicio de Lenguaje (LSP)** a través de una arquitectura en capas que abstrae la complejidad del protocolo LSP y proporciona características como autocompletado, diagnósticos en tiempo real y resaltado de errores.

## 🏗️ Arquitectura de Integración

```
.
└── frontend/
    └── src/
        └── app/
            ├── editor/
            │   ├── editor.ts                        # Componente principal del editor
            │   └── code-section/
            │       └── code-section.ts              # Envoltorio de CodeMirror con LSP
            └── services/
                ├── lsp-types.ts                     # Tipos de datos LSP
                ├── lsp-service.ts                   # Comunicación HTTP + WebSocket con API
                └── codemirror-lsp-service.ts        # Adaptador LSP para CodeMirror
```

## 📄 Archivos Clave

### 1. **lsp-types.ts** — Interfaces de Tipos LSP
**Responsabilidad**: Definir las interfaces TypeScript que corresponden al protocolo LSP

- **`LSPDiagnostic`**: Representa un problema de código (error, warning, info)
  - `range`: Posición del problema en el archivo
  - `severity`: Nivel de severidad (error=1, warning=2, info=3)
  - `message`: Descripción del problema
  - `code` / `source`: Referencia del problema

- **`LSPPosition`**: Define una posición en el código (línea y carácter)
  - `line`: Número de línea (0-indexado)
  - `character`: Posición del carácter en la línea

- **`LSPRange`**: Define un rango de texto con `start` y `end`

- **`LSPCompletionItem`**: Representa un item de autocompletado
  - `label`: Texto que se muestra
  - `kind`: Tipo de item (function, class, variable, etc.)
  - `insertText`: Texto a insertar
  - `documentation`: Descripción del item

### 2. **lsp-service.ts** — Servicio HTTP + WebSocket LSP
**Responsabilidad**: Comunicarse con la API de Lenguaje Service (LSP) y gestionar sesiones WebSocket

**Flujo Principal**:
```
Frontend → [HTTP POST] → API (/lsp/{projectId}) 
        ↓ Recibe WebSocket URL
Frontend → [WebSocket] → Multiplexor LSP en Contenedor Docker
```

**Métodos Principales**:
- **`getOrCreateContainer()`**: Crea o recupera un contenedor LSP para un proyecto
  - Envía petición HTTP POST a `/lsp/{projectId}`
  - Devuelve URL de WebSocket y configuración del contenedor

- **`initializeSession()`**: Inicializa una sesión LSP
  - Conecta WebSocket al multiplexor
  - Envía mensaje `initialize` para establecer el protocolo
  - Retorna objeto `LSPSession` con referencia al socket

- **`openDocument()`**: Abre un archivo en el servidor LSP
  - Notificación `textDocument/didOpen`
  - El servidor comienza a analizar el archivo

- **`updateDocument()`**: Sincroniza cambios de código con el servidor
  - Envía `textDocument/didChange` cuando el usuario escribe
  - Envía `textDocument/didSave` cada 600ms (debounced)

- **`requestCompletion()`**: Solicita autocompletado en una posición
  - Envía `textDocument/completion` con línea y carácter
  - Retorna lista de sugerencias

- **`shutdownSession()`**: Cierra la conexión WebSocket y limpia recursos

**Gestión de Sesiones**:
- Mantiene un `Map` de sesiones activas por `projectId:language`
- Una sesión = un proyecto + un lenguaje
- Reutiliza sesiones existentes si ya están conectadas
- Maneja débouncing para evitar saturar el servidor LSP

### 3. **codemirror-lsp-service.ts** — Adaptador LSP para CodeMirror
**Responsabilidad**: Adaptar el protocolo LSP genérico a las características de CodeMirror

**Componentes Principales**:
- **`attachLSPToEditor()`**: Conecta LSP a una instancia de CodeMirror
  - Inicializa sesión LSP
  - Configura linting (diagnósticos)
  - Configura autocompletado
  - Retorna extensiones de CodeMirror para agregar al editor

- **`createUpdateListener()`**: Crea una Extension de CodeMirror que escucha cambios
  - Incrementa versión del documento
  - Sincroniza cambios con `updateDocument()`
  - Activa autocompletado automático al escribir (opcional)

- **`createLintExtension()`**: Crea extensión de linting para mostrar diagnósticos
  - Consume diagnósticos del `LSPService`
  - Los transforma al formato de CodeMirror (`Diagnostic[]`)
  - Muestra errores/warnings en el editor

- **`createCompletionExtension()`**: Crea extensión de autocompletado
  - Escucha cuando el usuario abre el menú (Ctrl+Space) o escribe
  - Solicita completions al LSP
  - Filtra y muestra items disponibles

- **`detachLSP()`**: Desconecta LSP de un editor
  - Cierra el documento en el servidor
  - Limpia referencias locales

- **`shutdownProject()`**: Cierra todas las sesiones de un proyecto
  - Cierra todos los documentos abiertos
  - Detiene sesiones LSP por lenguaje

**Conversión de Coordenadas**:
- Convierte posiciones LSP (línea, carácter) a offsets de CodeMirror
- Maneja clamping para evitar índices fuera de rango

### 4. **editor.ts** — Componente Principal del Editor
**Responsabilidad**: Orquestar la interfaz del editor y la integración con LSP

**Características**:
- **Lenguajes Soportados**: Python, C++, TypeScript, JavaScript
- **Temas de Código**: OneDark, Dracula, Solarized, Nord, Kimbie
- **Ejecución de Código**: Integra con `ExecutionService` para ejecutar código
- **Colaboración**: Conecta con `CollabService` para edición colaborativa
- **LSP**: Usa `CodeMirrorLspService` para proporcionar asistencia de código

**Métodos Clave**:
- **`ngOnInit()`**: Inicializa el componente
  - Obtiene `projectId` de parámetros de URL
  - Conecta con el servicio de colaboración

- **`onLanguageChange()`**: Maneja cambio de lenguaje
  - Actualiza código por defecto
  - Nota: Idealmente debería reinicializar la sesión LSP

- **`onRunCode()`**: Ejecuta el código
  - Llama a `ExecutionService`
  - Muestra resultado y tiempo de ejecución

- **`ngOnDestroy()`**: Limpia recursos
  - Cierra sesión LSP al destruir componente

### 5. **code-section.ts** — Componente Envoltorio del Editor CodeMirror
**Responsabilidad**: Renderizar CodeMirror e integrar LSP a nivel de instancia del editor

**Características**:
- Renderiza el editor CodeMirror con el lenguaje especificado
- Gestiona cambios de código y emite eventos al componente padre
- Integra Language Server Protocol (LSP) automáticamente
- Soporta cambios dinámicos de lenguaje, tema y proyecto
- Sincroniza estado entre componente padre y CodeMirror

**Inputs (Propiedades que recibe)**:
- `value`: Código actual del editor
- `theme`: Tema de colores (light, dark, o extensión personalizada)
- `language`: Lenguaje actual (python, cpp, typescript, javascript)
- `projectId`: ID del proyecto para asociar con servidor LSP
- `filePath`: Nombre base del archivo sin extensión
- `lspEnabled`: Habilita/deshabilita soporte LSP
- `resultado`: Resultado de la última ejecución
- `resultadoOk`: Indicador de éxito/error de ejecución
- `cargando`: Indicador de carga durante ejecución

**Outputs (Eventos que emite)**:
- `valueChange`: Emitido cuando el usuario escribe (envía nuevo contenido)

**Métodos Clave**:
- **`ngAfterViewInit()`**: Obtiene referencia a EditorView e inicializa LSP
  - Con delay de 100ms para asegurar renderizado completo
  - Inicia sesión LSP si está habilitado

- **`ngOnChanges()`**: Reinicializa LSP cuando cambia lenguaje o proyecto
  - Detecta cambios en language, projectId, lspEnabled
  - Desconecta LSP anterior y conecta con nueva configuración
  - Permite cambiar dinámicamente sin perder la referencia al editor

- **`editorExtensions`** (getter): Construye array de extensiones CodeMirror
  - Incluye extensión de sintaxis del lenguaje
  - Añade extensiones LSP si están disponibles
  - Fallback a autocompletado genérico si LSP no está listo

- **`mapLanguageToLSP()`**: Convierte nombre de lenguaje a formato LSP
  - 'javascript' → 'typescript' (usa TypeScript LSP)
  - 'python' → 'python' (usa Python LSP)
  - 'cpp' → 'cpp' (usa C++ LSP)

- **`getFullPath()`**: Construye ruta completa del archivo
  - 'main' + 'python' → 'main.py'
  - Se usa para identificar el archivo en el servidor LSP

- **`onValueChange()`**: Maneja cambios de contenido del editor
  - Emite evento valueChange para padre

- **`toggleProblem()`**: Alterna visibilidad de sección de diagnósticos

**Ciclo de Vida**:
```
1. ngOnInit()
   ↓
2. (100ms delay)
3. ngAfterViewInit() → obtiene EditorView → initializeLSP()
   ↓
4. EditorView renderizado + extensiones aplicadas
   ↓
5. Usuario escribe → onValueChange() → valueChange event
   ↓
6. ngOnChanges() (si cambia language/projectId)
   → Desconecta LSP anterior
   → initializeLSP() con nueva configuración
   ↓
7. ngOnDestroy() → Desconecta LSP y limpia recursos
```

**Flujo de LSP en code-section**:
```
CodeSection
    ↓
ngAfterViewInit()
    ↓
initializeLSP()
    ↓
CodeMirrorLspService.attachLSPToEditor()
    ↓
Obtiene extensiones: [linting, autocompletado, updateListener]
    ↓
EditorView.dispatch() → Aplica extensiones
    ↓
Usuario escribe → updateListener detecta cambios → LSP sincroniza
                → LspService.updateDocument() → Server analiza
                → publishDiagnostics → Linting muestra errores
                
Usuario presiona Ctrl+Space → autocompletado activa
                             → requestCompletion() → Server devuelve items
                             → Popup de sugerencias
```

## 🔄 Flujo de Interacción Completo

```
1. Usuario abre el editor
   ↓
2. editor.ts → ngOnInit()
   ├─ Obtiene projectId de URL
   └─ Inicia colaboración
   
3. Usuario cambia lenguaje → onLanguageChange()
   ├─ Actualiza código por defecto
   └─ (Debería inicializar LSP aquí)
   
4. CodeSection carga CodeMirror
   ├─ code-section.ts → ngAfterViewInit()
   ├─ Obtiene referencia a EditorView
   └─ (delay 100ms para renderizado completo)
   
5. CodeSection inicializa LSP
   ├─ code-section.ts → initializeLSP()
   ├─ CodeMirrorLspService.attachLSPToEditor()
   ├─ LspService.initializeSession()
   │  ├─ HTTP POST → API para crear contenedor
   │  ├─ WebSocket → Multiplexor LSP
   │  └─ Envía initialize
   ├─ Abre documento (didOpen)
   └─ Adjunta extensiones (linting, autocompletado, updateListener)
   
6. Usuario escribe código
   ├─ updateListener detecta cambios
   ├─ code-section.ts → onValueChange()
   ├─ Emite valueChange → editor.ts actualiza código
   ├─ LspService.updateDocument() sincroniza
   ├─ Servidor LSP analiza código
   ├─ Servidor publica diagnósticos (publishDiagnostics)
   └─ CodeMirror muestra errores/warnings
   
7. Usuario presiona Ctrl+Space o escribe
   ├─ createCompletionExtension() activa
   ├─ LspService.requestCompletion() solicita items
   ├─ Servidor LSP devuelve sugerencias
   └─ CodeMirror muestra popup de completado
   
8. Usuario cambia de lenguaje
   ├─ editor.ts → onLanguageChange()
   ├─ code-section.ts → ngOnChanges()
   ├─ Desconecta LSP anterior
   └─ Reinicializa LSP con nuevo lenguaje
   
9. Usuario ejecuta código → onRunCode()
   ├─ ExecutionService.runCode()
   └─ Muestra resultado
   
10. Usuario cierra editor → ngOnDestroy()
    ├─ code-section.ts → ngOnDestroy()
    ├─ CodeMirrorLspService.detachLSP()
    └─ Cierra sesión LSP
```

## 🌐 Flujo de WebSocket

```
Cliente (Frontend)          Multiplexor WebSocket          Servidor LSP
       ↓                           ↓                           ↓
       └──── initialize ───────────→ ─────────────────────────→
       ←──── initialized ───────────── ←──────────────────────┘
       
       └─ didOpen, didChange ──────→ ─────────────────────────→
       ←─ publishDiagnostics ──────────←──────────────────────┘
       
       └─ completion request ──────→ ─────────────────────────→
       ←─ completion response ──────────←──────────────────────┘
       
       └─ didClose ────────────────→ ─────────────────────────→
```

## 🔌 Variables de Entorno Frontend

En `editor.ts`, se utiliza:
```typescript
const API_URL = enviroment.apiUrlLanguageServer || 'http://localhost:8135';
```

Asegúrate de configurar `enviroment.ts` con:
```typescript
export const enviroment = {
  apiUrlLanguageServer: 'http://localhost:8135', // URL de la API LSP Service
  // ... otras variables
};
```

## 🧪 Flujo de Prueba

1. **Inicia el API LSP Service**:
   ```bash
   cd LSP-Service/language-service
   python3 -m uvicorn app.main:app --reload --port 8135
   ```

2. **Inicia el frontend**:
   ```bash
   cd Proyecto_ARQ/frontend
   npm start
   ```

3. **Abre el editor** y verifica:
   - Diagnósticos de código (errores, warnings)
   - Autocompletado al escribir (Ctrl+Space)
   - Sincronización de cambios

## 📊 Diagrama de Componentes

```
┌─────────────────────────────────────────┐
│      Angular Frontend (editor.ts)       │
├─────────────────────────────────────────┤
│                                         │
│  ┌────────────────────────────────┐    │
│  │   CodeSection (code-section.ts)│    │
│  ├────────────────────────────────┤    │
│  │   CodeMirror Editor (UI)       │    │
│  └────────────────────────────────┘    │
│           ↓        ↓          ↓        │
│  ┌────────────────────────────────┐    │
│  │ CodeMirrorLspService           │    │
│  │ (Adaptador LSP → CodeMirror)   │    │
│  └────────────────────────────────┘    │
│           ↓                             │
│  ┌────────────────────────────────┐    │
│  │   LspService                   │    │
│  │   (Comunicación HTTP + WS)     │    │
│  └────────────────────────────────┘    │
└─────────────────────────────────────────┘
         ↓ HTTP POST / DELETE
┌─────────────────────────────────────────┐
│     API LSP Service (Python FastAPI)    │
│     :8135/lsp/{projectId}               │
└─────────────────────────────────────────┘
         ↓ WebSocket
┌─────────────────────────────────────────┐
│    Docker Container (Multiplexor LSP)   │
│    ├─ pylsp (Python)                    │
│    ├─ clangd (C++)                      │
│    └─ typescript-language-server (TS)   │
└─────────────────────────────────────────┘
```

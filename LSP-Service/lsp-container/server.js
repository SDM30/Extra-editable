// server.js - VERSIÓN CORREGIDA
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import { createInterface } from "readline";
import jwt from "jsonwebtoken";

/**
 * Multiplexor de Language Server Protocol (LSP)
 *
 * Actúa como un proxy que permite que múltiples clientes WebSocket compartan
 * una única instancia del servidor LSP, multiplexando mensajes entre ellos.
 *
 * @class LSPMultiplexer
 * @description Gestiona el ciclo de vida del servidor LSP y distribuye mensajes
 *              a todos los clientes conectados, manteniendo el estado de inicialización
 *              y manejando la reconexión de clientes posteriores.
 */
class LSPMultiplexer {
  /**
   * Crea una instancia del multiplexor LSP
   *
   * @constructor
   * @param {number} [port=3000] - Puerto para el servidor WebSocket
   * @throws {Error} Si no se puede iniciar el proceso LSP o el servidor WebSocket
   */
  constructor(port = 3000) {
    /** @property {number} port - Puerto del servidor WebSocket */
    this.port = port;

    /** @property {string} language - Lenguaje del LSP (python|cpp|typescript) */
    this.language = process.env.LANGUAGE || "python";

    /** @property {string} workDir - Directorio de trabajo para el LSP */
    this.workDir = process.env.WORKDIR || "/workspace";

    /** @property {ChildProcess} lspProcess - Proceso hijo del servidor LSP */
    this.lspProcess = null;

    /** @property {Set<WebSocket>} clients - Conjunto de clientes WebSocket conectados */
    this.clients = new Set();

    /** @property {boolean} isInitialized - Indica si el LSP ya fue inicializado */
    this.isInitialized = false;

    /** @property {number} maxClients - Número máximo de clientes simultáneos */
    this.maxClients = parseInt(process.env.MAX_CLIENTS) || 4;

    /** @property {Object} cachedCapabilities - Capacidades del LSP cacheadas */
    this.cachedCapabilities = {};

    /** @property {Object|null} cachedInitializeResult - Resultado completo de initialize para clientes futuros */
    this.cachedInitializeResult = null;

    /** @property {WebSocket|null} primaryClient - Cliente que realizó la inicialización real del LSP */
    this.primaryClient = null;

    /** @property {boolean} primaryInitializedForwarded - Si ya se reenvió 'initialized' al LSP */
    this.primaryInitializedForwarded = false;

    /** @property {boolean} defaultConfigurationSent - Si ya se envió configuración por defecto al LSP */
    this.defaultConfigurationSent = false;

    /** @property {number} nextInternalRequestId - Contador de IDs internos hacia el LSP */
    this.nextInternalRequestId = 1;

    /** @property {Map<number, { ws: WebSocket, clientRequestId: any }>} pendingRequests - Mapeo id interno -> cliente origen */
    this.pendingRequests = new Map();

    /** @property {Map<string, { text: string, watchers: Set<WebSocket> }>} documents - Estado canónico por URI (texto + watchers) */
    this.documents = new Map();

    /** @property {string} lspBuffer - Buffer para mensajes LSP incompletos */
    this.lspBuffer = Buffer.alloc(0);

    /** @property {number|null} contentLength - Longitud esperada del mensaje actual */
    this.contentLength = null;

    // Inicializar componentes
    this.startLSP();
    this.setupWebSocket();
  }

  /**
   * Inicia el proceso del servidor LSP
   *
   * @description Configura y ejecuta el comando LSP según el lenguaje seleccionado,
   *              establece los manejadores de eventos para stdout, stderr y close.
   * @returns {void}
   * @emits {Event} 'data' - Cuando el LSP envía datos por stdout/stderr
   * @emits {Event} 'close' - Cuando el proceso LSP termina
   */
  startLSP() {
    const lspConfig = this.getLSPConfig();

    console.log(`[LSPMultiplexer] Iniciando ${this.language} LSP`);
    console.log(
      `[LSPMultiplexer] Comando: ${lspConfig.command} ${lspConfig.args.join(" ")}`,
    );

    // Crear proceso hijo del LSP
    this.lspProcess = spawn(lspConfig.command, lspConfig.args, {
      cwd: this.workDir,
      env: { ...process.env, ...lspConfig.env },
    });

    /**
     * Manejador de errores del LSP
     * @listens stderr
     */
    this.lspProcess.stderr.on("data", (data) => {
      console.error(`[LSP] stderr: ${data.toString()}`);
    });

    /**
     * Manejador de cierre del proceso LSP
     * @listens close
     */
    this.lspProcess.on("close", (code) => {
      console.log(`[LSP] Proceso terminado con código ${code}`);
      this.lspProcess = null;
      this.isInitialized = false;

      // Cerrar todas las conexiones de clientes
      this.clients.forEach((client) => {
        if (client.readyState === 1) {
          // WebSocket.OPEN
          client.close(1011, "LSP process terminated");
        }
      });
      this.clients.clear();
    });

    /**
     * Manejador de salida estándar del LSP
     * @listens stdout
     */
    this.lspProcess.stdout.on("data", (data) => {
      // IMPORTANTE: LSP usa Content-Length en BYTES. No convertir a string aquí.
      this.handleLSPData(data);
    });
  }

  /**
   * Procesa los datos recibidos del LSP manejando el protocolo Content-Length
   *
   * @description Implementa el parsing del formato LSP estándar que usa headers
   *              Content-Length seguido de JSON. Acumula datos en buffer hasta
   *              tener mensajes completos para procesar.
   * @param {string} chunk - Fragmento de datos recibido del LSP
   * @returns {void}
   */
  handleLSPData(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.lspBuffer = Buffer.concat([this.lspBuffer, buf]);

    while (this.lspBuffer.length > 0) {
      // Si no tenemos content-length, buscar el header en el buffer
      if (this.contentLength === null) {
        // Buscar \r\n\r\n en los bytes
        const headerEnd = this.lspBuffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break; // Header incompleto

        // Leer el header como string (ASCII, seguro)
        const header = this.lspBuffer.slice(0, headerEnd).toString();
        const match = header.match(/Content-Length: (\d+)/i);
        if (!match) {
          console.error("[LSP] Header sin Content-Length:", header);
          this.lspBuffer = this.lspBuffer.slice(headerEnd + 4);
          continue;
        }
        this.contentLength = parseInt(match[1], 10);
        // Quitar el header del buffer
        this.lspBuffer = this.lspBuffer.slice(headerEnd + 4);
      }

      // ¿Tenemos suficientes bytes para el mensaje completo?
      if (this.lspBuffer.length >= this.contentLength) {
        // Extraer exactamente los bytes del mensaje
        const messageBytes = this.lspBuffer.slice(0, this.contentLength);
        this.lspBuffer = this.lspBuffer.slice(this.contentLength);
        this.contentLength = null;

        // Ahora decodificar y parsear
        const messageStr = messageBytes.toString();
        try {
          const message = JSON.parse(messageStr);

          const debug =
            process.env.DEBUG_LSPMUX === "1" || process.env.DEBUG_LSPMUX === "true";

          // Clasificar y despachar según JSON-RPC/LSP
          // - response: id + !method
          // - request: id + method
          // - notification: method + !id
          if (message && typeof message === "object") {
            if (message.id !== undefined && message.id !== null) {
              if (message.method) {
                if (debug) {
                  console.log(
                    `[LSPMultiplexer] <- request from LSP: ${message.method} (id=${message.id})`,
                  );
                }
                this.handleServerRequest(message);
              } else {
                // Response (por ejemplo: completion, hover, initialize, etc.)
                if (debug) {
                  const mapped = this.pendingRequests.get(message.id);
                  const method = mapped?.method ? ` method=${mapped.method}` : "";
                  console.log(
                    `[LSPMultiplexer] <- response from LSP: id=${message.id}${method}`,
                  );
                }
                this.routeResponseToClient(message);
              }
            } else if (message.method) {
              if (debug) {
                console.log(
                  `[LSPMultiplexer] <- notification from LSP: ${message.method}`,
                );
              }
              this.broadcast(message);
            }

            // Cachear initialize result para clientes posteriores
            // (se hace también en routeResponseToClient si es response de initialize).
            if (
              message.id !== undefined &&
              message.id !== null &&
              !message.method &&
              message.result &&
              typeof message.result === "object"
            ) {
              const mapping = this.pendingRequests.get(message.id);
              if (mapping?.method === "initialize") {
                this.cachedInitializeResult = message.result;
              }
            }
          }
        } catch (e) {
          console.error("[LSP] Error parseando mensaje:", e.message);
          console.error(
            "[LSP] Bytes:",
            messageBytes.length,
            "| Inicio:",
            messageStr.substring(0, 200),
          );
        }
      } else {
        break; // Esperar más datos
      }
    }
  }

  /**
   * Maneja requests del servidor LSP hacia el cliente (id + method).
   * Para mantener baja complejidad en el frontend, respondemos aquí con valores razonables.
   * @param {Object} request - Request JSON-RPC originado por el LSP
   */
  handleServerRequest(request) {
    const method = request.method;
    console.log(`[LSPMultiplexer] Request del LSP hacia cliente: ${method}`);

    const sendResult = (result) => {
      this.sendToLSP({ jsonrpc: "2.0", id: request.id, result });
    };

    const sendError = (code, message) => {
      this.sendToLSP({
        jsonrpc: "2.0",
        id: request.id,
        error: { code, message },
      });
    };

    try {
      if (method === "workspace/configuration") {
        const settings = this.getDefaultConfigurationForLanguage() || {};
        const items = request?.params?.items || [];

        const getBySection = (section) => {
          if (!section || typeof section !== "string") return settings;
          let current = settings;
          for (const key of section.split(".")) {
            if (current && typeof current === "object" && key in current) {
              current = current[key];
            } else {
              return {};
            }
          }
          return current ?? {};
        };

        const result = items.map((item) => getBySection(item?.section));
        sendResult(result);
        return;
      }

      if (method === "workspace/workspaceFolders") {
        sendResult([{ uri: `file://${this.workDir}`, name: "workspace" }]);
        return;
      }

      if (
        method === "client/registerCapability" ||
        method === "client/unregisterCapability"
      ) {
        sendResult(null);
        return;
      }

      if (method === "window/workDoneProgress/create") {
        sendResult(null);
        return;
      }

      // Default: responder null para no bloquear al servidor.
      sendResult(null);
    } catch (e) {
      console.error("[LSPMultiplexer] Error manejando request del LSP:", e);
      sendError(-32603, "Internal error handling server request");
    }
  }

  /**
   * Rutea una respuesta del LSP al cliente que originó el request.
   * Reemplaza el id interno por el id original del cliente.
   * @param {Object} message - Mensaje JSON-RPC de respuesta desde el LSP
   */
  routeResponseToClient(message) {
    const mapping = this.pendingRequests.get(message.id);
    if (!mapping) {
      console.warn(
        `[LSPMultiplexer] Response sin mapeo para id=${message.id}. Ignorando.`,
      );
      return;
    }

    const { ws, clientRequestId, method } = mapping;
    this.pendingRequests.delete(message.id);

    if (ws.readyState !== 1) {
      // WebSocket.OPEN
      return;
    }

    if (method === "initialize" && message?.result) {
      this.cachedInitializeResult = message.result;
    }

    const clientMessage = { ...message, id: clientRequestId };
    try {
      ws.send(JSON.stringify(clientMessage));
    } catch (e) {
      console.error("[LSPMultiplexer] Error enviando response al cliente:", e);
    }
  }

  /**
   * Envía un request al LSP reescribiendo el id para evitar colisiones entre clientes.
   * @param {WebSocket} ws - Cliente origen
   * @param {Object} message - Request JSON-RPC del cliente
   */
  forwardClientRequest(ws, message) {
    const internalId = this.nextInternalRequestId++;
    this.pendingRequests.set(internalId, {
      ws,
      clientRequestId: message.id,
      method: message.method,
    });

    const lspMessage = { ...message, id: internalId };
    this.sendToLSP(lspMessage);
  }

  /**
   * Envía un JSON-RPC error al cliente.
   * @param {WebSocket} ws
   * @param {*} requestId
   * @param {number} code
   * @param {string} message
   */
  sendJsonRpcError(ws, requestId, code, message) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        error: { code, message },
      }),
    );
  }

  /**
   * Envía un window/logMessage a un solo cliente (útil cuando se ignoran notifications).
   * @param {WebSocket} ws
   * @param {string} message
   */
  sendLogMessage(ws, message) {
    if (!ws || ws.readyState !== 1) return;
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "window/logMessage",
        params: { type: 3, message },
      }),
    );
  }

  /**
   * Valida position (line/character) contra el texto cacheado para un URI.
   * @param {string} uri
   * @param {{line: number, character: number}} position
   * @returns {{ok: true} | {ok: false, reason: string}}
   */
  validatePosition(uri, position) {
    const doc = this.documents.get(uri);
    if (!doc) return { ok: true };

    const line = position?.line;
    const character = position?.character;

    if (!Number.isInteger(line) || !Number.isInteger(character)) {
      return { ok: false, reason: "position.line/character must be integers" };
    }

    const lines = doc.text.split("\n");
    if (line < 0 || line >= lines.length) {
      return { ok: false, reason: "`line` parameter is not in a valid range" };
    }

    const lineText = lines[line] ?? "";
    if (character < 0 || character > lineText.length) {
      return {
        ok: false,
        reason: "`character` parameter is not in a valid range",
      };
    }

    return { ok: true };
  }

  /**
   * Obtiene la configuración del LSP según el lenguaje
   *
   * @description Retorna el comando, argumentos y variables de entorno
   *              necesarias para cada servidor LSP soportado.
   * @returns {Object} Configuración del LSP
   * @returns {string} returns.command - Comando ejecutable del LSP
   * @returns {string[]} returns.args - Argumentos de línea de comandos
   * @returns {Object} returns.env - Variables de entorno adicionales
   */
  getLSPConfig() {
    const configs = {
      python: {
        command: "pylsp",
        args: [],
        env: { PYTHONPATH: this.workDir },
      },
      cpp: {
        command: "clangd",
        args: [
          "--compile-commands-dir=" + this.workDir,
          "--background-index",
          "--clang-tidy",
          "--all-scopes-completion",
          "--completion-style=detailed",
          "--header-insertion=iwyu",
        ],
        env: {},
      },
      typescript: {
        command: "typescript-language-server",
        args: ["--stdio"],
        env: {},
      },
    };

    return configs[this.language] || configs.python;
  }

  getDefaultConfigurationForLanguage() {
    if (this.language === "python") {
      return {
        pylsp: {
          plugins: {
            pycodestyle: { enabled: true },
            pyflakes: { enabled: true },
            flake8: { enabled: true },
            mccabe: { enabled: true },
          },
        },
      };
    }

    if (this.language === "cpp") {
      // clangd se configura principalmente por flags y compile_commands.json.
      // Enviamos settings mínimos (harmless si clangd los ignora).
      return {
        clangd: {
          // Valores típicos; si no hay compilation database, clangd usa fallback.
          fallbackFlags: ["-std=c++17"],
        },
      };
    }

    if (this.language === "typescript") {
      // typescript-language-server usa settings tipo VSCode.
      // Enfocado en autocompletado (diagnósticos vienen de tsserver por defecto).
      return {
        typescript: {
          suggest: {
            completeFunctionCalls: true,
            includeAutomaticOptionalChainCompletions: true,
            autoImports: true,
          },
        },
        javascript: {
          suggest: {
            completeFunctionCalls: true,
            includeAutomaticOptionalChainCompletions: true,
            autoImports: true,
          },
        },
      };
    }

    return null;
  }

  sendDefaultConfigurationIfNeeded() {
    if (this.defaultConfigurationSent) return;
    const settings = this.getDefaultConfigurationForLanguage();
    if (!settings) return;

    this.defaultConfigurationSent = true;
    this.sendToLSP({
      jsonrpc: "2.0",
      method: "workspace/didChangeConfiguration",
      params: { settings },
    });
    console.log(
      `[LSPMultiplexer] Configuración por defecto enviada (${this.language})`,
    );
  }

  /**
   * Configura y inicia el servidor WebSocket
   *
   * @description Crea un servidor WebSocket que acepta conexiones de clientes,
   *              aplica límite de conexiones y configura manejadores de eventos
   *              para mensajes, cierre y errores.
   * @returns {void}
   * @emits {Event} 'connection' - Cuando un nuevo cliente se conecta
   */
  setupWebSocket() {
    this.wss = new WebSocketServer({
      port: this.port,
      host: "0.0.0.0",
    });

    console.log(`[LSPMultiplexer] WebSocket escuchando en puerto ${this.port}`);
    console.log(`[LSPMultiplexer] Máximo de clientes: ${this.maxClients}`);

    /**
     * Manejador de nuevas conexiones WebSocket
     * @listens connection
     */
    this.wss.on("connection", (ws, req) => {
      // ── Autenticación JWT ──────────────────────────────────────────────
      const JWT_SECRET = process.env.JWT_SECRET || "jwt-secreto";
      const PROJECT_ID = process.env.PROJECT_ID;

      try {
        const url = new URL(req.url, "http://localhost");
        const token = url.searchParams.get("token");

        if (!token) {
          console.warn("[LSPMultiplexer] Conexión rechazada: token requerido");
          ws.close(1008, "Token requerido");
          return;
        }

        const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });

        if (PROJECT_ID && payload.room !== PROJECT_ID) {
          console.warn(
            `[LSPMultiplexer] Conexión rechazada: room ${payload.room} != proyecto ${PROJECT_ID}`,
          );
          ws.close(1008, `No pertenece al proyecto ${PROJECT_ID}`);
          return;
        }

        ws.lspUser = {
          id: payload.sub,
          username: payload.username || "anon",
        };
        console.log(
          `[LSPMultiplexer] Usuario autenticado: ${ws.lspUser.username} (sub=${ws.lspUser.id})`,
        );
      } catch (e) {
        console.warn(`[LSPMultiplexer] Token inválido: ${e.message}`);
        ws.close(1008, "Token inválido o expirado");
        return;
      }

      // Validar límite de clientes
      if (this.clients.size >= this.maxClients) {
        console.warn(
          `[LSPMultiplexer] Cliente rechazado: límite alcanzado (${this.maxClients})`,
        );
        ws.close(1013, `Maximum clients reached (${this.maxClients})`);
        return;
      }

      const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      console.log(`[LSPMultiplexer] Nuevo cliente conectado: ${clientId}`);
      console.log(
        `[LSPMultiplexer] Total clientes: ${this.clients.size + 1}/${this.maxClients}`,
      );

      this.clients.add(ws);

      // Notificar al cliente si el LSP ya está inicializado
      if (this.isInitialized) {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "window/logMessage",
            params: {
              type: 3,
              message: `Connected to existing LSP session (${this.clients.size} clients)`,
            },
          }),
        );
      }

      /**
       * Manejador de mensajes del cliente
       * @listens message
       */
      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(ws, message);
        } catch (e) {
          console.error(`[${clientId}] Error parseando mensaje:`, e);
        }
      });

      /**
       * Manejador de cierre de conexión
       * @listens close
       */
      ws.on("close", () => {
        console.log(`[LSPMultiplexer] Cliente desconectado: ${clientId}`);
        this.clients.delete(ws);
        console.log(
          `[LSPMultiplexer] Clientes restantes: ${this.clients.size}/${this.maxClients}`,
        );

        // Si el cliente primario se desconecta, permitir que otro cliente envíe 'initialized' si hiciera falta
        if (this.primaryClient === ws) {
          this.primaryClient = null;
        }

        // Limpiar documentos: remover cliente de watchers, cerrar si no quedan watchers
        for (const [uri, doc] of this.documents.entries()) {
          doc.watchers.delete(ws);
          if (doc.watchers.size === 0) {
            this.documents.delete(uri);
            if (this.lspProcess && this.lspProcess.stdin.writable) {
              this.sendToLSP({
                jsonrpc: "2.0",
                method: "textDocument/didClose",
                params: { textDocument: { uri } },
              });
            }
          }
        }

        // Programar shutdown si no quedan clientes
        if (this.clients.size === 0) {
          this.scheduleShutdown();
        }
      });

      /**
       * Manejador de errores WebSocket
       * @listens error
       */
      ws.on("error", (error) => {
        console.error(`[${clientId}] Error WebSocket:`, error);
        this.clients.delete(ws);
      });
    });
  }

  /**
   * Procesa mensajes enviados por los clientes
   *
   * @description Maneja lógica especial para el método 'initialize',
   *              cacheando respuestas para clientes posteriores y reenviando
   *              otros mensajes al LSP.
   * @param {WebSocket} ws - Conexión WebSocket del cliente
   * @param {Object} message - Mensaje JSON-RPC del cliente
   * @param {string} message.method - Método JSON-RPC
   * @param {*} message.id - ID de la solicitud (para responses)
   * @param {Object} message.params - Parámetros del método
   * @returns {void}
   */
  handleClientMessage(ws, message) {
    // Bloquear métodos peligrosos en sesión compartida
    if (message.method === "shutdown" || message.method === "exit") {
      if (message.id !== undefined && message.id !== null) {
        this.sendJsonRpcError(
          ws,
          message.id,
          -32601,
          "Method not allowed in shared session",
        );
      }
      return;
    }

    // Manejo especial del método initialize
    if (message.method === "initialize") {
      if (!this.isInitialized) {
        // Primer cliente: inicializar LSP
        console.log("[LSPMultiplexer] Primera inicialización del LSP");
        this.isInitialized = true;
        this.primaryClient = ws;
        this.primaryInitializedForwarded = false;
        this.forwardClientRequest(ws, message);
      } else {
        // Clientes adicionales: responder desde cache si está disponible
        console.log("[LSPMultiplexer] Cliente adicional - LSP ya inicializado");
        if (this.cachedInitializeResult) {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: this.cachedInitializeResult,
            }),
          );
        } else {
          this.sendJsonRpcError(
            ws,
            message.id,
            -32002,
            "LSP is still initializing. Retry shortly.",
          );
        }
      }
      return;
    }

    // Evitar que clientes secundarios envíen initialized al LSP
    if (message.method === "initialized") {
      if (this.primaryClient === null && !this.primaryInitializedForwarded) {
        this.primaryClient = ws;
      }

      if (ws === this.primaryClient && !this.primaryInitializedForwarded) {
        this.primaryInitializedForwarded = true;
        this.sendToLSP(message);
        this.sendDefaultConfigurationIfNeeded();
      } else {
        this.sendLogMessage(
          ws,
          "Ignoring initialized notification (shared LSP session)",
        );
      }
      return;
    }

    // Sin proceso LSP disponible, ignorar silenciosamente
    if (!this.lspProcess || !this.lspProcess.stdin.writable) {
      return;
    }

    // Mantener estado canónico de documentos (watchers)
    if (message.method === "textDocument/didOpen") {
      const uri = message?.params?.textDocument?.uri;
      const text = message?.params?.textDocument?.text ?? "";
      if (typeof uri === "string") {
        const existing = this.documents.get(uri);
        if (!existing) {
          this.documents.set(uri, { text, watchers: new Set([ws]) });
          this.sendToLSP(message);
        } else {
          existing.watchers.add(ws);
          if (typeof text === "string" && text.length > 0) {
            existing.text = text;
          }
        }
        return;
      }
    }

    if (message.method === "textDocument/didChange") {
      const uri = message?.params?.textDocument?.uri;
      if (typeof uri === "string") {
        const existing = this.documents.get(uri);
        if (!existing) {
          this.documents.set(uri, { text: "", watchers: new Set([ws]) });
        }
        const doc = this.documents.get(uri);
        doc.watchers.add(ws);
        const newText = message?.params?.contentChanges?.[0]?.text;
        if (typeof newText === "string") {
          doc.text = newText;
        }
        this.sendToLSP(message);
        return;
      }
    }

    if (message.method === "textDocument/didClose") {
      const uri = message?.params?.textDocument?.uri;
      if (typeof uri === "string") {
        const existing = this.documents.get(uri);
        if (!existing) {
          return;
        }
        existing.watchers.delete(ws);
        if (existing.watchers.size === 0) {
          this.documents.delete(uri);
          this.sendToLSP(message);
        }
        return;
      }
    }

    if (message.method === "textDocument/didSave") {
      const uri = message?.params?.textDocument?.uri;
      if (typeof uri === "string") {
        const existing = this.documents.get(uri);
        if (!existing) {
          this.sendToLSP(message);
          return;
        }
        existing.watchers.add(ws);
        this.sendToLSP(message);
        return;
      }
    }

    // Validación de position para requests comunes
    const needsPositionValidation =
      message.method === "textDocument/completion" ||
      message.method === "textDocument/hover" ||
      message.method === "textDocument/definition";

    if (
      needsPositionValidation &&
      message?.params?.textDocument?.uri &&
      message?.params?.position
    ) {
      const uri = message.params.textDocument.uri;
      const validation = this.validatePosition(uri, message.params.position);
      if (!validation.ok) {
        if (message.id !== undefined && message.id !== null) {
          this.sendJsonRpcError(ws, message.id, -32602, validation.reason);
        }
        return;
      }
    }

    // Reenviar otros mensajes al LSP si el proceso está disponible
    if (message.id !== undefined && message.id !== null && message.method) {
      // Request: reescribir id y rutear response
      this.forwardClientRequest(ws, message);
    } else {
      // Notification: reenviar tal cual
      this.sendToLSP(message);
    }
  }

  /**
   * Envía un mensaje al proceso LSP con el formato correcto
   *
   * @description Formatea el mensaje JSON-RPC según el protocolo LSP,
   *              añadiendo el header Content-Length necesario.
   * @param {Object} message - Mensaje JSON-RPC a enviar
   * @returns {void}
   */
  sendToLSP(message) {
    if (
      !this.lspProcess ||
      !this.lspProcess.stdin ||
      !this.lspProcess.stdin.writable
    ) {
      console.warn(
        "[LSPMultiplexer] LSP stdin no disponible; descartando mensaje",
      );
      return;
    }

    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

    console.log(
      `[LSPMultiplexer] Enviando a LSP: ${message.method || "response"}`,
    );
    this.lspProcess.stdin.write(header + content);
  }

  /**
   * Distribuye un mensaje a todos los clientes conectados
   *
   * @description Envía el mensaje a todos los clientes WebSocket activos,
   *              limpiando automáticamente las conexiones muertas.
   * @param {Object} message - Mensaje JSON-RPC a broadcast
   * @returns {void}
   */
  broadcast(message) {
    const messageStr = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        try {
          client.send(messageStr);
        } catch (e) {
          console.error("[LSPMultiplexer] Error enviando a cliente:", e);
          this.clients.delete(client);
        }
      } else {
        this.clients.delete(client);
      }
    });
  }

  /**
   * Programa el apagado automático del servidor
   *
   * @description Cuando no hay clientes conectados, inicia un temporizador
   *              que terminará el proceso después del tiempo de inactividad
   *              configurado, a menos que llegue un nuevo cliente.
   * @returns {void}
   */
  scheduleShutdown() {
    const idleTimeout = parseInt(process.env.IDLE_TIMEOUT) || 300000;
    console.log(
      `[LSPMultiplexer] Sin clientes, programando shutdown en ${idleTimeout / 1000}s`,
    );

    setTimeout(() => {
      if (this.clients.size === 0) {
        console.log("[LSPMultiplexer] Shutdown por inactividad");
        if (this.lspProcess) {
          this.lspProcess.kill();
        }
        process.exit(0);
      }
    }, idleTimeout);
  }
}

// Iniciar multiplexor
const port = parseInt(process.env.LSPMUX_PORT) || 3000;
new LSPMultiplexer(port);

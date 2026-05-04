/**
 * lsp-service.ts
 *
 * Servicio de comunicación HTTP + WebSocket con la API de Lenguaje Service (LSP).
 *
 * Este servicio es responsable de:
 * 1. Crear/recuperar contenedores Docker con el servidor LSP para un proyecto
 * 2. Establecer conexiones WebSocket con el multiplexor LSP
 * 3. Gestionar sesiones LSP (una por projectId + language)
 * 4. Enviar/recibir mensajes del protocolo LSP (initialize, didOpen, didChange, completion, etc.)
 * 5. Exponer observables para diagnostivos y autocompletado
 *
 * @module services/lsp-service
 */
// app/services/lsp.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, ReplaySubject, Subject, firstValueFrom } from 'rxjs';
import { enviroment } from '../environments/enviroment';

/**
 * Respuesta de la API al crear/consultar un contenedor LSP
 *
 * Contiene la información necesaria para conectar con el multiplexor LSP
 * que se ejecuta dentro del contenedor Docker.
 *
 * @interface LSPContainerResponse
 * @property {string} message - Mensaje descriptivo de la operación
 * @property {string} project_id - Identificador del proyecto
 * @property {string} container_id - ID del contenedor Docker
 * @property {string} language - Lenguaje del servidor LSP (python, cpp, typescript)
 * @property {string} ws_url - URL para conectar WebSocket (ej: ws://127.0.0.1:32768)
 * @property {number} ws_port - Puerto WebSocket asignado
 * @property {number} max_clients - Máximo número de clientes simultáneos
 */
export interface LSPContainerResponse {
  message: string;
  project_id: string;
  container_id: string;
  language: string;
  ws_url: string;
  ws_port: number;
  max_clients: number;
}

/**
 * Representa una sesión LSP activa
 *
 * Una sesión existe para cada combinación única de projectId + language.
 * Mantiene el estado de la conexión WebSocket y los requests pendientes.
 *
 * @interface LSPSession
 * @property {string} projectId - ID del proyecto
 * @property {string} language - Lenguaje de programación (python, cpp, typescript)
 * @property {string} wsUrl - URL del WebSocket
 * @property {number} wsPort - Puerto del WebSocket
 * @property {string} containerId - ID del contenedor Docker
 * @property {WebSocket|null} socket - Conexión WebSocket activa (null si no conectada)
 * @property {boolean} connected - True si el WebSocket está abierto
 * @property {boolean} initialized - True si se completó el handshake LSP (initialize/initialized)
 * @property {number} messageId - ID incremental para los requests (para correlation)
 * @property {Map} pendingRequests - Map de id → callback para requests esperando respuesta
 */
export interface LSPSession {
  projectId: string;
  language: string;
  wsUrl: string;
  wsPort: number;
  containerId: string;
  socket: WebSocket | null;
  connected: boolean;
  initialized: boolean;
  messageId: number;
  pendingRequests: Map<number, (response: any) => void>;
}

@Injectable({
  providedIn: 'root',
})
export class LspService {
  private readonly API_URL = enviroment.apiUrlLanguageServer || 'http://localhost:8135';
  private activeSessions: Map<string, LSPSession> = new Map();
  private saveTimersByUri: Map<string, any> = new Map();

  // Observables para notificar eventos
  private diagnosticsSubject = new ReplaySubject<{ uri: string; diagnostics: any[] }>(1);
  public diagnostics$ = this.diagnosticsSubject.asObservable();

  private completionSubject = new Subject<{ id: number; items: any[] }>();
  public completion$ = this.completionSubject.asObservable();

  constructor(private http: HttpClient) {}

  /**
   * Crea o recupera un contenedor LSP para el proyecto
   *
   * Realiza una petición HTTP POST a `/lsp/{projectId}` en la API de Lenguaje Service.
   * Si el contenedor ya existe, la API lo reutiliza. Si es nuevo, lo crea en Docker.
   *
   * @param {string} projectId - Identificador único del proyecto
   * @param {string} language - Lenguaje de programación (python, cpp, typescript)
   * @param {number} [maxClients=4] - Máximo número de clientes concurrentes permitidos
   * @returns {Promise<LSPContainerResponse>} Información del contenedor (URL WebSocket, puerto, etc.)
   * @throws {Error} Si la API retorna error o no hay conexión
   *
   * @example
   * const response = await lspService.getOrCreateContainer('my-project', 'python');
   * console.log(response.ws_url); // ws://127.0.0.1:32768
   */
  async getOrCreateContainer(
    projectId: string,
    language: string,
    maxClients: number = 4,
  ): Promise<LSPContainerResponse> {
    const response = await firstValueFrom(
      this.http.post<LSPContainerResponse>(`${this.API_URL}/lsp/${projectId}`, {
        language,
        max_clients: maxClients,
      }),
    );
    return response;
  }

  /**
   * Inicializa una sesión LSP para un proyecto
   *
   * Este es el método principal para establecer la conexión con el servidor LSP.
   * Realiza lo siguiente:
   * 1. Verifica si ya existe una sesión activa y la reutiliza
   * 2. Crea un contenedor via getOrCreateContainer() si es necesario
   * 3. Establece conexión WebSocket
   * 4. Inicializa el protocolo LSP (handshake initialize/initialized)
   * 5. Almacena la sesión en el registro interno
   *
   * @param {string} projectId - Identificador del proyecto
   * @param {string} language - Lenguaje de programación
   * @returns {Promise<LSPSession>} La sesión LSP inicializada y lista para usar
   * @throws {Error} Si hay timeout conectando o si falla la inicialización LSP
   *
   * @example
   * const session = await lspService.initializeSession('my-project', 'python');
   * console.log(session.initialized); // true
   */
  async initializeSession(projectId: string, language: string): Promise<LSPSession> {
    const sessionKey = this.getSessionKey(projectId, language);

    // Verificar si ya existe sesión
    if (this.activeSessions.has(sessionKey)) {
      const session = this.activeSessions.get(sessionKey)!;
      if (session.connected) {
        console.log(`[LSP] Reutilizando sesión existente para ${projectId} (${language})`);
        return session;
      }
    }

    // Crear contenedor vía API
    const container = await this.getOrCreateContainer(projectId, language);

    // Crear sesión
    const session: LSPSession = {
      projectId,
      language,
      wsUrl: container.ws_url,
      wsPort: container.ws_port,
      containerId: container.container_id,
      socket: null,
      connected: false,
      initialized: false,
      messageId: 1,
      pendingRequests: new Map(),
    };

    // Conectar WebSocket
    await this.connectWebSocket(session);

    this.activeSessions.set(sessionKey, session);
    return session;
  }

  /**
   * Conecta el WebSocket al multiplexor LSP
   */
  private connectWebSocket(session: LSPSession): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[LSP] Conectando a ${session.wsUrl}`);

      const socket = new WebSocket(session.wsUrl);
      session.socket = socket;

      const timeout = setTimeout(() => {
        reject(new Error('Timeout conectando al LSP'));
      }, 10000);

      socket.onopen = () => {
        console.log(`[LSP] WebSocket conectado para ${session.projectId}`);
        session.connected = true;
        clearTimeout(timeout);

        // Inicializar LSP
        this.initializeLSP(session)
          .then(() => {
            resolve();
          })
          .catch(reject);
      };

      socket.onmessage = (event) => {
        this.handleMessage(session, event.data);
      };

      socket.onerror = (error) => {
        console.error(`[LSP] Error WebSocket:`, error);
        session.connected = false;
      };

      socket.onclose = (event) => {
        console.log(`[LSP] WebSocket cerrado: ${event.code} - ${event.reason}`);
        session.connected = false;
        session.initialized = false;
      };
    });
  }

  /**
   * Inicializa el protocolo LSP
   */
  private initializeLSP(session: LSPSession): Promise<void> {
    return new Promise((resolve, reject) => {
      const initMessage = {
        jsonrpc: '2.0',
        id: this.getNextMessageId(session),
        method: 'initialize',
        params: {
          processId: null,
          rootUri: 'file:///workspace',
          capabilities: {
            textDocument: {
              synchronization: {
                didSave: true,
              },
              completion: {
                completionItem: { snippetSupport: true },
              },
              hover: {
                contentFormat: ['markdown', 'plaintext'],
              },
              definition: { linkSupport: true },
              publishDiagnostics: { relatedInformation: true },
            },
            workspace: {
              workspaceFolders: true,
            },
          },
          workspaceFolders: [
            {
              uri: 'file:///workspace',
              name: session.projectId,
            },
          ],
        },
      };

      // Registrar callback para la respuesta
      session.pendingRequests.set(initMessage.id, (response) => {
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          console.log(`[LSP] Inicializado correctamente`);
          session.initialized = true;

          // Enviar notificación initialized
          this.sendNotification(session, 'initialized', {});
          resolve();
        }
      });

      this.sendRaw(session, initMessage);
    });
  }

  /**
   * Maneja mensajes recibidos del servidor LSP
   */
  private handleMessage(session: LSPSession, data: string): void {
    try {
      const message = JSON.parse(data);

      // Respuesta a un request
      if (message.id !== undefined) {
        const callback = session.pendingRequests.get(message.id);
        if (callback) {
          callback(message);
          session.pendingRequests.delete(message.id);
        }
      }

      // Notificación
      if (message.method) {
        this.handleNotification(session, message);
      }
    } catch (e) {
      console.error('[LSP] Error parseando mensaje:', e);
    }
  }

  /**
   * Maneja notificaciones del servidor LSP
   */
  private handleNotification(session: LSPSession, message: any): void {
    switch (message.method) {
      case 'textDocument/publishDiagnostics':
        const params = message.params;
        console.log(
          `[LSP] Diagnósticos recibidos: ${params.diagnostics?.length || 0} problemas para ${params.uri}`,
        );
        this.diagnosticsSubject.next({
          uri: params.uri,
          diagnostics: params.diagnostics || [],
        });
        break;

      case 'window/logMessage':
        console.log(`[LSP] Log: ${message.params.message}`);
        break;

      default:
        // Otros métodos
        break;
    }
  }

  /**
   * Abre un documento en el servidor LSP
   *
   * Envía la notificación `textDocument/didOpen` para que el servidor comience
   * a analizar el archivo. El servidor puede generar diagnósticos tras recibir esta notificación.
   *
   * @param {LSPSession} session - La sesión LSP activa
   * @param {string} filePath - Ruta relativa del archivo (ej: 'main.py')
   * @param {string} content - Contenido completo del archivo
   * @param {string} language - ID del lenguaje (python, cpp, typescript)
   * @throws No lanza errores; registra warning si la sesión no está inicializada
   *
   * @example
   * lspService.openDocument(session, 'app.py', 'import os\nos.path.', 'python');
   */
  openDocument(session: LSPSession, filePath: string, content: string, language: string): void {
    if (!session.initialized) {
      console.warn('[LSP] Sesión no inicializada');
      return;
    }

    const uri = `file:///workspace/${filePath}`;

    this.sendNotification(session, 'textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: language,
        version: 1,
        text: content,
      },
    });

    console.log(`[LSP] Documento abierto: ${uri}`);
  }

  /**
   * Actualiza un documento cuando el usuario escribe
   *
   * Envía la notificación `textDocument/didChange` con el contenido actualizado.
   * Implementa debouncing (~600ms) antes de enviar `textDocument/didSave` para evitar
   * saturar el servidor con demasiadas notificaciones.
   *
   * El servidor LSP puede generar diagnósticos después de recibir didSave.
   *
   * @param {LSPSession} session - La sesión LSP activa
   * @param {string} filePath - Ruta relativa del archivo
   * @param {string} content - Contenido actualizado completo del archivo
   * @param {number} version - Número de versión del documento (incremental)
   * @throws No lanza errores; retorna silenciosamente si la sesión no está inicializada
   *
   * @example
   * lspService.updateDocument(session, 'app.py', 'import os\nos.path.exists', 2);
   */
  updateDocument(session: LSPSession, filePath: string, content: string, version: number): void {
    if (!session.initialized) return;

    const uri = `file:///workspace/${filePath}`;

    this.sendNotification(session, 'textDocument/didChange', {
      textDocument: {
        uri,
        version,
      },
      contentChanges: [{ text: content }],
    });

    // pylsp suele publicar diagnósticos con más consistencia en didSave.
    // Debounce para evitar saturar.
    const existingTimer = this.saveTimersByUri.get(uri);
    if (existingTimer) clearTimeout(existingTimer);

    this.saveTimersByUri.set(
      uri,
      setTimeout(() => {
        this.sendNotification(session, 'textDocument/didSave', {
          textDocument: { uri },
          text: content,
        });
        this.saveTimersByUri.delete(uri);
      }, 600),
    );
  }

  /**
   * Solicita autocompletado en una posición específica del código
   *
   * Envía un request `textDocument/completion` al servidor LSP.
   * El servidor devuelve una lista de sugerencias basadas en el contexto.
   *
   * Incluye timeout de seguridad de 3 segundos para evitar quedarse esperando.
   *
   * @param {LSPSession} session - La sesión LSP activa
   * @param {string} filePath - Ruta relativa del archivo
   * @param {number} line - Número de línea (0-indexado)
   * @param {number} character - Posición del carácter en la línea (0-indexado)
   * @returns {Promise<any[]>} Array de items de autocompletado (LSPCompletionItem[])
   * @throws No lanza errores; devuelve array vacío si hay timeout o error
   *
   * @example
   * const items = await lspService.requestCompletion(session, 'app.py', 5, 10);
   * // items[0].label → 'forEach', 'filter', etc.
   */
  async requestCompletion(
    session: LSPSession,
    filePath: string,
    line: number,
    character: number,
  ): Promise<any[]> {
    if (!session.initialized) {
      console.warn('[LSP] Sesión no inicializada');
      return [];
    }

    return new Promise((resolve) => {
      const messageId = this.getNextMessageId(session);
      const uri = `file:///workspace/${filePath}`;

      session.pendingRequests.set(messageId, (response) => {
        if (response.result) {
          const items = response.result.items || response.result || [];
          this.completionSubject.next({ id: messageId, items });
          resolve(items);
        } else {
          resolve([]);
        }
      });

      this.sendRaw(session, {
        jsonrpc: '2.0',
        id: messageId,
        method: 'textDocument/completion',
        params: {
          textDocument: { uri },
          position: { line, character },
        },
      });

      // Timeout de seguridad
      setTimeout(() => {
        if (session.pendingRequests.has(messageId)) {
          session.pendingRequests.delete(messageId);
          resolve([]);
        }
      }, 3000);
    });
  }

  /**
   * Cierra un documento en el servidor LSP
   *
   * Envía la notificación `textDocument/didClose` para que el servidor
   * libere recursos asociados al archivo.
   *
   * @param {LSPSession} session - La sesión LSP activa
   * @param {string} filePath - Ruta relativa del archivo
   * @throws No lanza errores; retorna silenciosamente si la sesión no está inicializada
   *
   * @example
   * lspService.closeDocument(session, 'app.py');
   */
  closeDocument(session: LSPSession, filePath: string): void {
    if (!session.initialized) return;

    const uri = `file:///workspace/${filePath}`;
    this.sendNotification(session, 'textDocument/didClose', {
      textDocument: { uri },
    });
  }

  /**
   * Cierra la sesión LSP y libera recursos
   *
   * Cierra el WebSocket y elimina la sesión del registro interno.
   *
   * Nota: En un LSP compartido (multiplexor), no enviamos shutdown/exit
   * ya que eso cerraría la sesión para todos los clientes. Solo cerramos
   * la conexión del cliente actual.
   *
   * @param {string} projectId - Identificador del proyecto
   * @param {string} language - Lenguaje de programación
   * @returns {Promise<void>}
   * @throws No lanza errores; es segura de llamar múltiples veces
   *
   * @example
   * await lspService.shutdownSession('my-project', 'python');
   */
  async shutdownSession(projectId: string, language: string): Promise<void> {
    const sessionKey = this.getSessionKey(projectId, language);
    const session = this.activeSessions.get(sessionKey);
    if (!session || !session.socket) return;

    // En un LSP compartido, `shutdown/exit` puede estar bloqueado en el proxy para
    // evitar que un cliente tumbe la sesión de todos. Cerramos solo el WebSocket.
    try {
      session.socket.close();
    } finally {
      this.activeSessions.delete(sessionKey);
    }
  }

  // Métodos auxiliares
  private getNextMessageId(session: LSPSession): number {
    return session.messageId++;
  }

  private sendNotification(session: LSPSession, method: string, params: any): void {
    this.sendRaw(session, {
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  private sendRaw(session: LSPSession, message: any): void {
    if (session.socket && session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Obtiene el estado actual de un contenedor LSP
   *
   * Realiza una petición HTTP GET a `/lsp/{projectId}` para consultar
   * información sobre el contenedor (si está activo, número de clientes, etc.).
   *
   * @param {string} projectId - Identificador del proyecto
   * @param {string} [language] - Lenguaje opcional para filtrar
   * @returns {Promise<any>} Información del estado del contenedor
   * @throws {Error} Si la API retorna error
   */
  async getContainerStatus(projectId: string, language?: string): Promise<any> {
    const url = language
      ? `${this.API_URL}/lsp/${projectId}?language=${encodeURIComponent(language)}`
      : `${this.API_URL}/lsp/${projectId}`;

    return firstValueFrom(this.http.get(url));
  }

  /**
   * Elimina/destruye un contenedor LSP
   *
   * Realiza una petición HTTP DELETE a `/lsp/{projectId}` para
   * detener y eliminar el contenedor Docker del proyecto.
   *
   * @param {string} projectId - Identificador del proyecto
   * @param {string} [language] - Lenguaje opcional
   * @returns {Promise<void>}
   * @throws {Error} Si la API retorna error
   */
  async destroyContainer(projectId: string, language?: string): Promise<void> {
    const url = language
      ? `${this.API_URL}/lsp/${projectId}?language=${encodeURIComponent(language)}`
      : `${this.API_URL}/lsp/${projectId}`;

    await firstValueFrom(this.http.delete(url));
  }

  private getSessionKey(projectId: string, language: string): string {
    return `${projectId}:${language}`;
  }
}

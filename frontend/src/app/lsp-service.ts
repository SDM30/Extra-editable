// app/services/lsp.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, ReplaySubject, Subject, firstValueFrom } from 'rxjs';
import { enviroment } from './environments/enviroment';

export interface LSPContainerResponse {
  message: string;
  project_id: string;
  container_id: string;
  language: string;
  ws_url: string;
  ws_port: number;
  max_clients: number;
}

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
  providedIn: 'root'
})
export class LspService {
  private readonly API_URL = enviroment.apiUrlLanguageServer || 'http://localhost:8000';
  private activeSessions: Map<string, LSPSession> = new Map();
  private saveTimersByUri: Map<string, any> = new Map();
  
  // Observables para notificar eventos
  private diagnosticsSubject = new ReplaySubject<{uri: string, diagnostics: any[]}>(1);
  public diagnostics$ = this.diagnosticsSubject.asObservable();
  
  private completionSubject = new Subject<{id: number, items: any[]}>();
  public completion$ = this.completionSubject.asObservable();

  constructor(private http: HttpClient) {}

  /**
   * Crea o recupera un contenedor LSP para el proyecto
   */
  async getOrCreateContainer(
    projectId: string, 
    language: string, 
    maxClients: number = 4
  ): Promise<LSPContainerResponse> {
    const response = await firstValueFrom(
      this.http.post<LSPContainerResponse>(
        `${this.API_URL}/lsp/${projectId}`,
        { language, max_clients: maxClients }
      )
    );
    return response;
  }

  /**
   * Inicializa una sesión LSP para un proyecto
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
      pendingRequests: new Map()
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
        this.initializeLSP(session).then(() => {
          resolve();
        }).catch(reject);
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
        jsonrpc: "2.0",
        id: this.getNextMessageId(session),
        method: "initialize",
        params: {
          processId: null,
          rootUri: "file:///workspace",
          capabilities: {
            textDocument: {
              synchronization: {
                didSave: true
              },
              completion: {
                completionItem: { snippetSupport: true }
              },
              hover: {
                contentFormat: ["markdown", "plaintext"]
              },
              definition: { linkSupport: true },
              publishDiagnostics: { relatedInformation: true }
            },
            workspace: {
              workspaceFolders: true
            }
          },
          workspaceFolders: [{
            uri: "file:///workspace",
            name: session.projectId
          }]
        }
      };

      // Registrar callback para la respuesta
      session.pendingRequests.set(initMessage.id, (response) => {
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          console.log(`[LSP] Inicializado correctamente`);
          session.initialized = true;
          
          // Enviar notificación initialized
          this.sendNotification(session, "initialized", {});
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
        console.log(`[LSP] Diagnósticos recibidos: ${params.diagnostics?.length || 0} problemas para ${params.uri}`);
        this.diagnosticsSubject.next({
          uri: params.uri,
          diagnostics: params.diagnostics || []
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
        text: content
      }
    });
    
    console.log(`[LSP] Documento abierto: ${uri}`);
  }

  /**
   * Actualiza un documento (cuando el usuario escribe)
   */
  updateDocument(session: LSPSession, filePath: string, content: string, version: number): void {
    if (!session.initialized) return;

    const uri = `file:///workspace/${filePath}`;
    
    this.sendNotification(session, 'textDocument/didChange', {
      textDocument: {
        uri,
        version
      },
      contentChanges: [{ text: content }]
    });

    // pylsp suele publicar diagnósticos con más consistencia en didSave.
    // Debounce para evitar saturar.
    const existingTimer = this.saveTimersByUri.get(uri);
    if (existingTimer) clearTimeout(existingTimer);

    this.saveTimersByUri.set(uri, setTimeout(() => {
      this.sendNotification(session, 'textDocument/didSave', {
        textDocument: { uri },
        text: content
      });
      this.saveTimersByUri.delete(uri);
    }, 600));
  }

  /**
   * Solicita autocompletado
   */
  async requestCompletion(
    session: LSPSession, 
    filePath: string, 
    line: number, 
    character: number
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
        jsonrpc: "2.0",
        id: messageId,
        method: "textDocument/completion",
        params: {
          textDocument: { uri },
          position: { line, character }
        }
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
   * Cierra un documento
   */
  closeDocument(session: LSPSession, filePath: string): void {
    if (!session.initialized) return;

    const uri = `file:///workspace/${filePath}`;
    this.sendNotification(session, 'textDocument/didClose', {
      textDocument: { uri }
    });
  }

  /**
   * Cierra la sesión LSP
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
      jsonrpc: "2.0",
      method,
      params
    });
  }

  private sendRaw(session: LSPSession, message: any): void {
    if (session.socket && session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Obtiene el estado de un contenedor
   */
  async getContainerStatus(projectId: string, language?: string): Promise<any> {
    const url = language
      ? `${this.API_URL}/lsp/${projectId}?language=${encodeURIComponent(language)}`
      : `${this.API_URL}/lsp/${projectId}`;

    return firstValueFrom(
      this.http.get(url)
    );
  }

  /**
   * Elimina un contenedor
   */
  async destroyContainer(projectId: string, language?: string): Promise<void> {
    const url = language
      ? `${this.API_URL}/lsp/${projectId}?language=${encodeURIComponent(language)}`
      : `${this.API_URL}/lsp/${projectId}`;

    await firstValueFrom(
      this.http.delete(url)
    );
  }

  private getSessionKey(projectId: string, language: string): string {
    return `${projectId}:${language}`;
  }
}

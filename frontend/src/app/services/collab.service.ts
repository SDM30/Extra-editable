import { Injectable, OnDestroy } from '@angular/core';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { BehaviorSubject, Subject } from 'rxjs';
import { enviroment } from '../environments/enviroment';

export interface CollabUser {
  userId: string;
  username: string;
  color: string;
}

@Injectable({ providedIn: 'root' })
export class CollabService implements OnDestroy {
  // Map para providers de proyecto (project-level room)
  private projectProviders: Map<string, { provider: HocuspocusProvider; ydoc: Y.Doc }> = new Map();
  private provider: HocuspocusProvider | null = null;
  private ydoc: Y.Doc | null = null;
  private currentDocumentName: string | null = null;
  private connectingToDocument: string | null = null;  // Flag para prevenir múltiples intentos simultáneos
  private connectPromise: Promise<HocuspocusProvider> | null = null;
  private connectionVersion = 0;

  // Emite cuando la conexión está lista y el Y.Text ya existe
  readonly ready$ = new Subject<void>();
  readonly collaborators$ = new BehaviorSubject<CollabUser[]>([]);
  private _synced = false;

  isReady(): boolean {
    return this._synced;
  }

  getConnectionVersion(): number {
    return this.connectionVersion;
  }

  getCurrentDocumentName(): string | null {
    return this.currentDocumentName;
  }

  async connect(documentName: string, token: string, username: string, userId?: string): Promise<HocuspocusProvider> {
    // Si ya estamos conectados a este documento, regresar la conexión existente
    if (this.provider && this.currentDocumentName === documentName) {
      console.log('[collab] ✓ Ya conectado a', documentName);
      return this.provider;
    }

    // Si ya hay una promesa de conexión en curso, retornarla
    // Evitar race condition: solo retornar la promesa en curso si es para el mismo room
    if (this.connectPromise && this.connectingToDocument === documentName) {
      return this.connectPromise;
    }

    this.connectingToDocument = documentName;
    console.log('[collab] 🔗 Iniciando conexión a', documentName);

    // Hot-swap strategy: create a new provider and only destroy the old one
    // after the new one has synchronized to avoid losing awareness/presence
    // during document switches.
    const oldProvider = this.provider;
    const oldYdoc = this.ydoc;

    this.connectionVersion += 1;
    const newYdoc = new Y.Doc();

    this.connectPromise = new Promise<HocuspocusProvider>((resolve, reject) => {
      try {
        const newProvider = new HocuspocusProvider({
          url: enviroment.collabUrl.replace(/^http/, 'ws'),
          name: documentName,
          document: newYdoc,
          token,
          onConnect: () => {
            console.log('[collab] ✅ (new) Conectado a', documentName);
            this.connectingToDocument = null; // Limpiar el flag
            const idToSet = userId || username || 'anon';
            try {
              newProvider?.setAwarenessField('user', {
                id: idToSet,
                name: username,
                color: this.randomColor(),
              });
            } catch (e) {
              console.warn('[collab] Warning setting awareness field on new provider', e);
            }
          },
          onSynced: () => {
            console.log('[collab] 🔄 (new) Documento sincronizado', documentName);
            this._synced = true;
            // Swap providers atomically
            try {
              if (oldProvider) {
                try {
                  oldProvider.destroy();
                } catch (e) {
                  console.warn('[collab] Error destroying old provider', e);
                }
              }
              if (oldYdoc) {
                try {
                  oldYdoc.destroy();
                } catch (e) {
                  /* ignore */
                }
              }
            } finally {
              this.provider = newProvider;
              this.ydoc = newYdoc;
              this.currentDocumentName = documentName;
              this.ready$.next();
              resolve(this.provider);
              this.connectPromise = null;
            }
          },
          onAwarenessUpdate: (data) => {
            // Diagnostic: log raw awareness payload
            console.debug('[collab] Raw awareness payload:', data);
            const rawList: CollabUser[] = [];
            if (Array.isArray(data?.states)) {
              (data.states as any[]).forEach((entry: any) => {
                const user = entry?.user ?? entry?.state?.user;
                const clientId = entry?.clientId ?? entry?.client;
                if (user) {
                  rawList.push({
                    userId: String(user.id ?? user.userId ?? clientId ?? 'anon'),
                    username: String(user.name ?? user.username ?? 'Anónimo'),
                    color: String(user.color ?? '#94a3b8'),
                  });
                }
              });
            } else {
              try {
                const aw = newProvider?.awareness as any;
                const statesIter = aw?.getStates ? aw.getStates() : aw?.states;
                if (statesIter) {
                  const entries = statesIter instanceof Map ? Array.from(statesIter.entries()) : Object.entries(statesIter);
                  entries.forEach(([clientId, state]: any) => {
                    const user = state?.user ?? state?.state?.user;
                    if (user) {
                      rawList.push({
                        userId: String(user.id ?? user.userId ?? clientId ?? 'anon'),
                        username: String(user.name ?? user.username ?? 'Anónimo'),
                        color: String(user.color ?? '#94a3b8'),
                      });
                    }
                  });
                }
              } catch (e) {
                console.warn('[collab] Warning reading awareness states:', e);
              }
            }

            const dedup = new Map<string, CollabUser>();
            for (const u of rawList) {
              if (!dedup.has(u.userId)) dedup.set(u.userId, u);
            }

            const finalList = Array.from(dedup.values()).slice(0, 4);
            console.debug('[collab] Parsed collaborators:', finalList);
            this.collaborators$.next(finalList);
          },
          onDisconnect: () => {
            console.log('[collab] ❌ (new) Desconectado de', documentName);
          },
          onAuthenticationFailed: ({ reason }) => {
            const tokenPreview =
              typeof token === 'string' && token.length > 12 ? `${token.slice(0, 12)}…` : token;
            console.error('[collab] 🔐 Auth fallida (new):', { reason, token: tokenPreview });
            reject(new Error('Authentication failed'));
            this.connectPromise = null;
          },
        });
      } catch (err) {
        this.connectPromise = null;
        reject(err);
      }
    });

    return this.connectPromise;
  }

  // Conecta a una sala a nivel de proyecto (ej: project:123) sin reemplazar
  // la conexión principal de archivo. Permite observar metadata compartida
  // como la lista de archivos.
  async connectProject(projectId: number | string, token: string, username: string, userId?: string): Promise<HocuspocusProvider> {
    const roomName = `${projectId}`;
    if (this.projectProviders.has(roomName)) {
      return this.projectProviders.get(roomName)!.provider;
    }

    const projYdoc = new Y.Doc();

    return new Promise<HocuspocusProvider>((resolve, reject) => {
      try {
        const projProvider = new HocuspocusProvider({
          url: enviroment.collabUrl.replace(/^http/, 'ws'),
          name: roomName,
          document: projYdoc,
          token,
          onConnect: () => {
            try {
              const idToSet = userId || username || 'anon';
              projProvider?.setAwarenessField('user', {
                id: idToSet,
                name: username,
                color: this.randomColor(),
              });
            } catch (e) {
              console.warn('[collab] Warning setting awareness on project provider', e);
            }
          },
          onSynced: () => {
            console.log('[collab] ✅ Project synced', roomName);
            this.projectProviders.set(roomName, { provider: projProvider, ydoc: projYdoc });
            resolve(projProvider);
          },
          onDisconnect: () => {
            console.log('[collab] ❌ Project disconnected', roomName);
            // keep map entry for now; explicit disconnect will clean up
          },
          onAuthenticationFailed: ({ reason }) => {
            console.error('[collab] Project auth failed', { reason });
            reject(new Error('Project authentication failed'));
          },
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  getProjectFilesArray(projectId: number | string): Y.Array<any> | null {
    const roomName = `${projectId}`;
    const entry = this.projectProviders.get(roomName);
    if (!entry) return null;
    try {
      return entry.ydoc.getArray('files');
    } catch (e) {
      return null;
    }
  }

  // Empuja metadata de archivo al Y.Array del proyecto para notificar a otros clientes
  pushProjectFile(projectId: number | string, fileMeta: any): boolean {
    const arr = this.getProjectFilesArray(projectId);
    if (!arr) return false;
    try {
      arr.push([fileMeta]);
      return true;
    } catch (e) {
      console.warn('[collab] Could not push project file to Y.Array', e);
      return false;
    }
  }

  /** Notifica a otros clientes que un archivo fue eliminado.
   * Siempre empuja un marcador al Y.Array para que el observer se dispare,
   * incluso si el elemento no está presente en el array compartido. */
  deleteProjectFile(projectId: number | string, fileId: number): void {
    const arr = this.getProjectFilesArray(projectId);
    if (!arr) return;
    try {
      arr.push([{ _op: 'delete', id: fileId, _ts: Date.now() }]);
      for (let i = 0; i < arr.length; i++) {
        const el = arr.get(i);
        if (el && el.id === fileId && !el._op) {
          arr.delete(i);
          break;
        }
      }
    } catch (e) {
      console.warn('[collab] Could not delete project file from Y.Array', e);
    }
  }

  /** Notifica a otros clientes que un archivo fue renombrado.
   * Siempre empuja un marcador al Y.Array para que el observer se dispare. */
  renameProjectFile(projectId: number | string, fileId: number, newName: string): void {
    const arr = this.getProjectFilesArray(projectId);
    if (!arr) return;
    try {
      arr.push([{ _op: 'rename', id: fileId, nombre: newName, _ts: Date.now() }]);
      for (let i = 0; i < arr.length; i++) {
        const el = arr.get(i);
        if (el && el.id === fileId && !el._op) {
          arr.delete(i);
          arr.insert(i, [{ ...el, nombre: newName }]);
          break;
        }
      }
    } catch (e) {
      console.warn('[collab] Could not rename project file in Y.Array', e);
    }
  }

  getSharedText(fieldName = 'codemirror'): Y.Text | null {
    return this.ydoc?.getText(fieldName) ?? null;
  }

  getDoc(): Y.Doc | null {
    return this.ydoc;
  }

  getProvider(): HocuspocusProvider | null {
    return this.provider;
  }

  /** Desconecta todas las conexiones WebSocket (archivo + proyecto). */
  disconnect(): void {
    this.provider?.destroy();
    this.ydoc?.destroy();
    this.provider = null;
    this.ydoc = null;
    this.currentDocumentName = null;
    this._synced = false;
    this.collaborators$.next([]);
    this.connectionVersion += 1;
    for (const entry of this.projectProviders.values()) {
      try { entry.provider.destroy(); } catch { /* ignore */ }
      try { entry.ydoc.destroy(); } catch { /* ignore */ }
    }
    this.projectProviders.clear();
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private randomColor(): string {
    const colors = ['#f28b82', '#fbbc04', '#34a853', '#4285f4', '#a142f4'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

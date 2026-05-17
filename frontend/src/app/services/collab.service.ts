import { Injectable, OnDestroy } from '@angular/core';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { BehaviorSubject, Subject } from 'rxjs';

export interface CollabUser {
  userId: string;
  username: string;
  color: string;
}

@Injectable({ providedIn: 'root' })
export class CollabService implements OnDestroy {
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
    if (this.connectPromise) {
      console.log('[collab] ⏳ Esperando conexión en progreso a', this.connectingToDocument);
      return this.connectPromise;
    }

    this.connectingToDocument = documentName;
    console.log('[collab] 🔗 Iniciando conexión a', documentName);

    // Desconectar si hay una conexión antigua
    if (this.provider) {
      this.disconnect();
    }

    this.currentDocumentName = documentName;
    this.connectionVersion += 1;
    this.ydoc = new Y.Doc();

    this.connectPromise = new Promise<HocuspocusProvider>((resolve, reject) => {
      try {
        this.provider = new HocuspocusProvider({
          url: 'ws://localhost:8083',
          name: documentName,
          document: this.ydoc!,
          token,
          onConnect: () => {
            console.log('[collab] ✅ Conectado a', documentName);
            this.connectingToDocument = null; // Limpiar el flag
            // Registrar estado de awareness con `id` y `name` para ser compatible
            // con otros helpers que esperan `{ user: { id, name, color } }`.
            const idToSet = userId || username || 'anon';
            this.provider?.setAwarenessField('user', {
              id: idToSet,
              name: username,
              color: this.randomColor(),
            });
          },
          onSynced: () => {
            console.log('[collab] 🔄 Documento sincronizado', documentName);
            this._synced = true;
            // Emitir listo SOLO cuando ya se ha sincronizado el documento remoto
            this.ready$.next();
            resolve(this.provider!);
            this.connectPromise = null;
          },
          onAwarenessUpdate: (data) => {
            const rawList: CollabUser[] = [];

            // data may be an object with a `states` array, or the provider's
            // awareness API may be used to retrieve a Map of clientId → state.
            if (Array.isArray(data?.states)) {
              (data.states as any[]).forEach((entry: any) => {
                const user = entry?.user ?? entry?.state?.user;
                const clientId = entry?.clientId ?? entry?.clientId ?? entry?.client;
                if (user) {
                  rawList.push({
                    userId: String(user.id ?? user.userId ?? clientId ?? 'anon'),
                    username: String(user.name ?? user.username ?? 'Anónimo'),
                    color: String(user.color ?? '#94a3b8'),
                  });
                }
              });
            } else {
              // Fallback: read from the provider's awareness map if available
              try {
                const aw = this.provider?.awareness as any;
                const statesIter = aw?.getStates ? aw.getStates() : aw?.states;
                if (statesIter) {
                  // statesIter may be a Map or an object; normalize to entries
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

            // Deduplicate by userId to avoid showing the same logical user twice
            const dedup = new Map<string, CollabUser>();
            for (const u of rawList) {
              if (!dedup.has(u.userId)) dedup.set(u.userId, u);
            }

            const finalList = Array.from(dedup.values()).slice(0, 4);
            this.collaborators$.next(finalList);
          },
          onDisconnect: () => {
            console.log('[collab] ❌ Desconectado de', documentName);
          },
          onAuthenticationFailed: ({ reason }) => {
            const tokenPreview =
              typeof token === 'string' && token.length > 12 ? `${token.slice(0, 12)}…` : token;
            console.error('[collab] 🔐 Auth fallida:', { reason, token: tokenPreview });
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

  getSharedText(fieldName = 'codemirror'): Y.Text | null {
    return this.ydoc?.getText(fieldName) ?? null;
  }

  getDoc(): Y.Doc | null {
    return this.ydoc;
  }

  getProvider(): HocuspocusProvider | null {
    return this.provider;
  }

  disconnect(): void {
    this.provider?.destroy();
    this.ydoc?.destroy();
    this.provider = null;
    this.ydoc = null;
    this.currentDocumentName = null;
    this._synced = false;
    this.collaborators$.next([]);
    this.connectionVersion += 1;
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private randomColor(): string {
    const colors = ['#f28b82', '#fbbc04', '#34a853', '#4285f4', '#a142f4'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

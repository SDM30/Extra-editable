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
          url: 'ws://localhost:8083',
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

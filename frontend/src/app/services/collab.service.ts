import { Injectable, OnDestroy } from '@angular/core';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { BehaviorSubject, ReplaySubject } from 'rxjs';

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

  // Emite cuando la conexión está lista y el Y.Text ya existe
  readonly ready$ = new ReplaySubject<void>(1);
  readonly collaborators$ = new BehaviorSubject<CollabUser[]>([]);
  private _synced = false;

  isReady(): boolean {
    return this._synced;
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
    this.ydoc = new Y.Doc();

    this.connectPromise = new Promise<HocuspocusProvider>((resolve, reject) => {
      try {
        this.provider = new HocuspocusProvider({
          url: 'ws://localhost:1234',
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
            const list: CollabUser[] = [];
            const states = Array.isArray(data?.states) ? data.states : [];

            states.forEach((entry: any) => {
              const user = entry?.user;
              if (user) {
                list.push({
                  userId: String(user.id ?? user.userId ?? entry.clientId),
                  username: String(user.name ?? user.username ?? 'Anónimo'),
                  color: String(user.color ?? '#94a3b8'),
                });
              }
            });

            this.collaborators$.next(list.slice(0, 4));
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
    this._synced = false;
    this.collaborators$.next([]);
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private randomColor(): string {
    const colors = ['#f28b82', '#fbbc04', '#34a853', '#4285f4', '#a142f4'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

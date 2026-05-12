import { Injectable, OnDestroy } from '@angular/core';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { BehaviorSubject } from 'rxjs';

export interface CollaboratorInfo {
  clientId: number;
  userId: string;
  name: string;
  color: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'synced';

@Injectable({ providedIn: 'root' })
export class CollaborationService implements OnDestroy {
  private provider: HocuspocusProvider | null = null;
  private ydoc: Y.Doc | null = null;

  private readonly serverUrl =
    (window as any).__ENV?.COLLAB_URL || 'ws://localhost:8083';

  readonly status$ = new BehaviorSubject<ConnectionStatus>('disconnected');
  readonly collaborators$ = new BehaviorSubject<CollaboratorInfo[]>([]);

  /**
   * Conecta a una sesión colaborativa identificada por documentName.
   * Retorna el Y.Text compartido que se pasa a yCollab() en CodeMirror.
   *
   * @param documentName  Identificador de la sesión (ej: "ejercicio-42")
   * @param token         JWT del usuario. Opcional en desarrollo.
   * @param userInfo      Datos del usuario para el awareness (nombre, color)
   */
  connect(
    documentName: string,
    token?: string,
    userInfo?: { id: string; name: string; color: string }
  ): { yText: Y.Text; awareness: any } {
    this.disconnect();

    this.ydoc = new Y.Doc();
    this.status$.next('connecting');

    this.provider = new HocuspocusProvider({
      url: this.serverUrl,
      name: documentName,
      document: this.ydoc,
      token: token ?? 'dev-token',

      onConnect: () => {
        console.log(`[collab] conectado → ${documentName}`);
        this.status$.next('connected');
      },

      onSynced: () => {
        console.log(`[collab] sincronizado → ${documentName}`);
        this.status$.next('synced');
      },

      onDisconnect: () => {
        console.log(`[collab] desconectado → ${documentName}`);
        this.status$.next('disconnected');
      },

      onAwarenessUpdate: (data) => {
        const list: CollaboratorInfo[] = [];
        data.states.forEach((state) => {
          const clientId = state.clientId;
          const user = state?.['user'];
          if (user) {
            list.push({
              clientId,
              userId: user.id ?? 'anon',
              name: user.name ?? 'Anónimo',
              color: user.color ?? '#94a3b8',
            });
          }
        });
        this.collaborators$.next(list);
      },
    });

    // Registrar presencia del usuario local en el awareness
    const localUser = userInfo ?? {
      id: 'dev-user',
      name: 'Dev',
      color: this.pickColor(),
    };
    this.provider.setAwarenessField('user', localUser);

    const yText = this.ydoc.getText('codemirror');
    const awareness = this.provider.awareness;

    return { yText, awareness };
  }

  disconnect(): void {
    this.provider?.destroy();
    this.ydoc?.destroy();
    this.provider = null;
    this.ydoc = null;
    this.status$.next('disconnected');
    this.collaborators$.next([]);
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private pickColor(): string {
    const colors = [
      '#f87171', '#fb923c', '#facc15', '#4ade80',
      '#34d399', '#38bdf8', '#818cf8', '#e879f9',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
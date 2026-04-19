import { Injectable, OnDestroy } from '@angular/core';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

export interface CollabUser {
  userId: string;
  username: string;
  color: string;
}

@Injectable({ providedIn: 'root' })
export class CollabService implements OnDestroy {
  private provider: HocuspocusProvider | null = null;
  private ydoc: Y.Doc | null = null;

  connect(documentName: string, token: string, username: string): HocuspocusProvider {
    this.disconnect();

    this.ydoc = new Y.Doc();

    this.provider = new HocuspocusProvider({
      url: 'ws://localhost:1234',
      name: documentName,
      document: this.ydoc,
      token,
      onConnect: () => {
        console.log('[collab] Conectado a', documentName);
        this.provider?.setAwarenessField('user', {
          username,
          color: this.randomColor(),
        });
      },
      onDisconnect: () => console.log('[collab] Desconectado'),
      onAuthenticationFailed: ({ reason }) =>
        console.error('[collab] Auth fallida:', reason),
    });

    return this.provider;
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
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private randomColor(): string {
    const colors = ['#f28b82', '#fbbc04', '#34a853', '#4285f4', '#a142f4'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

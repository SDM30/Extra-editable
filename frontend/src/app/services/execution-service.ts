import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { enviroment } from '../environments/enviroment';

export type ExecutionMessage =
  | { type: 'connected'; data: string }
  | { type: 'started' }
  | { type: 'output'; data: string }
  | { type: 'error'; data: string }
  | { type: 'timeout'; data: string }
  | { type: 'finished'; exitCode: number };

@Injectable({
  providedIn: 'root'
})
export class ExecutionService {
  private onMessageCb?: (message: ExecutionMessage) => void;
  private onErrorCb?: () => void;
  private onCloseCb?: () => void;

  constructor(private http: HttpClient) {}

  connect(
    onMessage: (message: ExecutionMessage) => void,
    onError?: () => void,
    onClose?: () => void
  ): void {
    this.onMessageCb = onMessage;
    this.onErrorCb = onError;
    this.onCloseCb = onClose;
    
    // Simulate connection for the existing UI flow
    setTimeout(() => {
      this.onMessageCb?.({ type: 'connected', data: '' });
    }, 100);
  }

  runCode(language: string, code: string): void {
    this.onMessageCb?.({ type: 'started' });
    
    this.http.post<any>(`${enviroment.ejecutarUrl}/run`, {
      contenido: code
    }).subscribe({
      next: (response) => {
        if (response.resultado) {
          this.onMessageCb?.({ type: 'output', data: String(response.resultado) });
        }
        this.onMessageCb?.({ type: 'finished', exitCode: 0 });
      },
      error: (err) => {
        this.onMessageCb?.({ type: 'error', data: err.message || 'Error en la ejecución' });
        this.onMessageCb?.({ type: 'finished', exitCode: 1 });
      }
    });
  }

  sendInput(input: string): void {
    this.onMessageCb?.({ type: 'error', data: 'La entrada interactiva no está soportada en modo REST.' });
  }

  stop(): void {
    // API REST actual no lo soporta
  }

  disconnect(): void {
    this.onCloseCb?.();
  }
}
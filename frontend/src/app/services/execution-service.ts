import { Injectable } from '@angular/core';
import { enviroment } from '../environments/enviroment';

export type ExecutionMessage =
  | { type: 'connected'; data: string }
  | { type: 'queued'; position: number; language: string }
  | { type: 'dequeued'; data: string }
  | { type: 'started' }
  | { type: 'output'; data: string }
  | { type: 'error'; data: string }
  | { type: 'timeout'; data: string }
  | { type: 'finished'; exitCode: number };

@Injectable({
  providedIn: 'root',
})
export class ExecutionService {
  private socket?: WebSocket;

  connect(
    onMessage: (message: ExecutionMessage) => void,
    onError?: () => void,
    onClose?: () => void,
  ): void {
    this.socket = new WebSocket(`${enviroment.ejecutarUrl}`);

    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as ExecutionMessage;
      onMessage(message);
    };

    this.socket.onerror = () => {
      if (onError) onError();
    };

    this.socket.onclose = () => {
      if (onClose) onClose();
    };
  }

  runCode(language: string, code: string): void {
    this.socket?.send(
      JSON.stringify({
        type: 'run',
        language,
        code,
      }),
    );
  }

  sendInput(input: string): void {
    this.socket?.send(
      JSON.stringify({
        type: 'input',
        data: input + '\n',
      }),
    );
  }

  stop(): void {
    this.socket?.send(
      JSON.stringify({
        type: 'stop',
      }),
    );
  }

  disconnect(): void {
    this.socket?.close();
  }
}

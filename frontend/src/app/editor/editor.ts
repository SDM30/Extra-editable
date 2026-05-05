import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { finalize, timeout } from 'rxjs';
import { Extension } from '@codemirror/state';

import { Header } from './headerIDE/headerIDE';
import { CodeSection } from './code-section/code-section';

import { oneDark } from '@codemirror/theme-one-dark';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { solarizedLight, solarizedDark } from '@uiw/codemirror-theme-solarized';
import { nord } from '@uiw/codemirror-theme-nord';
import { kimbie } from '@uiw/codemirror-theme-kimbie';
import { ExecutionService } from '../services/execution-service';
import { CollabService } from '../services/collab.service';
import { AuthService } from '../services/auth.service';

export type Theme = 'light' | 'dark' | Extension;

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [Header, CodeSection],
  templateUrl: './editor.html',
  styleUrls: ['./editor.css'],
})
export class Editor implements OnInit, OnDestroy {
  value = `#include <iostream>\n\nint main() {\n    std::cout << "Hola C++" << std::endl;\n    return 0;\n}`;

  theme: Theme = 'dark';
  language: string = 'cpp';

  themeOptions = [
    { label: 'Standard Light', value: 'light' as Theme },
    { label: 'Standard Dark', value: 'dark' as Theme },
    { label: 'One Dark', value: oneDark as Theme },
    { label: 'Dracula', value: dracula as Theme },
    { label: 'Solarized Light', value: solarizedLight as Theme },
    { label: 'Solarized Dark', value: solarizedDark as Theme },
    { label: 'Nord', value: nord as Theme },
    { label: 'Kimbie', value: kimbie as Theme },
  ];

  languageOptions = [
    { label: 'C++', value: 'cpp' },
    { label: 'JavaScript', value: 'javascript' },
    { label: 'Python', value: 'python' },
  ];

  resultado?: string;
  resultadoOk?: boolean;
  cargando = false;
  projectId: string = 'default-project';
  lspEnabled: boolean = true;
  terminalHeight: number = 220;
  collaborators: Array<{ userId: string; username: string; color: string }> = [];
  private collaboratorsSub?: Subscription;

  constructor(
    private executionService: ExecutionService,
    private cdr: ChangeDetectorRef,
    private collab: CollabService,
    private auth: AuthService,
  ) {}

  async ngOnInit() {
    console.log('[Editor] solicitando token collab...');
    // Obtiene (o genera) la identidad del usuario y pide el token al servidor collab
    const { token, username, userId } = await this.auth.getCollabToken();
    console.log('[Editor] token recibido para', username);
    // Conecta al documento compartido. Todos los que entren a 'room-editor-1' comparten el mismo código.
    console.log('[Editor] llamando collab.connect()');
    try {
      this.collaboratorsSub?.unsubscribe();
      this.collaboratorsSub = this.collab.collaborators$.subscribe((list) => {
        this.collaborators = list;
        this.cdr.detectChanges();
      });

      await this.collab.connect('room-editor-1', token, username, userId);
      console.log('[Editor] collab.connect() completado');
    } catch (err) {
      console.error('[Editor] Error en collab.connect():', err);
    }
  }

  ngOnDestroy(): void {
    this.collaboratorsSub?.unsubscribe();
  }
  // Método invocado desde la plantilla. Alias en español para compatibilidad.
  ejecutarCodigo(): void {
    this.onRunCode();
  }

  onLanguageChange(newLang: string): void {
    this.language = newLang;
  }

  startResize(ev: MouseEvent): void {
    // Placeholder: se puede manejar arrastrar tamaño del terminal desde aquí.
    console.log('[Editor] startResize', ev.type);
  }

  enviarEntrada(input: string): void {
    this.executionService.sendInput(input);
  }

  private onRunCode(): void {
    this.resultado = undefined;
    this.resultadoOk = undefined;
    this.cargando = true;
    this.cdr.detectChanges();

    const sharedCode = this.collab.getSharedText('codemirror')?.toString();
    const codeToRun = sharedCode && sharedCode.length > 0 ? sharedCode : this.value;
    let accumulated = '';

    this.executionService.connect(
      (message) => {
        switch (message.type) {
          case 'output':
            accumulated += message.data;
            this.resultado = accumulated;
            break;
          case 'dequeued':
            accumulated += message.data || '';
            break;
          case 'error':
            accumulated += '\n[error] ' + message.data;
            break;
          case 'finished':
            this.cargando = false;
            this.resultado = accumulated;
            this.resultadoOk = message.exitCode === 0;
            this.cdr.detectChanges();
            break;
          default:
            // otros mensajes: queued, started, timeout
            break;
        }
      },
      () => {
        // onError
        this.cargando = false;
        this.resultado = 'Error: conexión de ejecución fallida';
        this.cdr.detectChanges();
      },
      () => {
        // onClose
        this.cargando = false;
        this.cdr.detectChanges();
      },
    );

    // Enviar petición de ejecución
    this.executionService.runCode(this.language, codeToRun);
  }

  private limpiarResultado(resultado: string): string {
    return resultado.replace(/^id\s*=\s*[^|]*\|\s*/i, '');
  }

  private extraerEstadoOk(resultado: string): boolean | undefined {
    const match = resultado.match(/(^|\n)\s*ok\s*=\s*(true|false)\s*(\n|$)/i);
    if (!match) return undefined;
    return match[2].toLowerCase() === 'true';
  }

  private formatearSalida(resultado: string, tiempo?: string): string {
    return `${resultado}\ntiempo=${tiempo ?? 'N/A'}`;
  }
}

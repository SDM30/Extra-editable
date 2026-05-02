/**
 * editor.ts
 *
 * Componente principal del editor de código con soporte para múltiples lenguajes.
 *
 * Conserva:
 * - Ejecución por WebSocket (ExecutionService)
 * - Terminal con stdin + resize
 * - Colaboración (CollabService/AuthService)
 * - Integración LSP (CodeMirrorLspService) vía CodeSection
 */
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Extension } from '@codemirror/state';

import { oneDark } from '@codemirror/theme-one-dark';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { solarizedLight, solarizedDark } from '@uiw/codemirror-theme-solarized';
import { nord } from '@uiw/codemirror-theme-nord';
import { kimbie } from '@uiw/codemirror-theme-kimbie';

import { Header } from './headerIDE/headerIDE';
import { CodeSection } from './code-section/code-section';

import { ExecutionService } from '../services/execution-service';
import { CollabService } from '../services/collab.service';
import { AuthService } from '../services/auth.service';
import { CodeMirrorLspService } from '../services/codemirror-lsp-service';

export type Theme = 'light' | 'dark' | Extension;

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [Header, CodeSection],
  templateUrl: './editor.html',
  styleUrl: './editor.css',
})
export class Editor implements OnInit, OnDestroy {
  private defaultCode: Record<string, string> = {
    cpp: `#include <iostream>\n\nint main() {\n    std::cout << "Hola C++" << std::endl;\n    return 0;\n}`,
    python: `def hello():\n    print("Hello, World!")\n\nif __name__ == "__main__":\n    hello()`,
    typescript: `function greet(name: string): string {\n    return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("World"));`,
    javascript: `function greet(name) {\n    return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("World"));`,
  };

  value = this.defaultCode['cpp'];
  theme: Theme = 'dark';
  language: string = 'cpp';

  // Colaboración + LSP
  projectId: string = 'proyecto-demo';
  lspEnabled: boolean = true;

  // Terminal / ejecución
  resultado: string = '';
  resultadoOk: boolean = false;
  cargando: boolean = false;

  terminalHeight = 220;
  private isResizing = false;
  private startY = 0;
  private startHeight = 220;

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
    { label: 'Python', value: 'python' },
    { label: 'C++', value: 'cpp' },
    { label: 'TypeScript', value: 'typescript' },
    { label: 'JavaScript', value: 'javascript' },
  ];

  constructor(
    private executionService: ExecutionService,
    private cdr: ChangeDetectorRef,
    private collab: CollabService,
    private auth: AuthService,
    private lspService: CodeMirrorLspService,
    private route: ActivatedRoute,
  ) {}

  async ngOnInit() {
    this.route.queryParams.subscribe((params) => {
      this.projectId = params['projectId'] || 'proyecto-demo';
      console.log(`[Editor] Project ID: ${this.projectId}`);
    });

    const { token, username } = await this.auth.getCollabToken();
    this.collab.connect('room-editor-1', token, username);
  }

  ngOnDestroy(): void {
    if (this.lspEnabled) {
      this.lspService.shutdownProject(this.projectId).catch(console.error);
    }
  }

  onLanguageChange(language: string) {
    this.language = language;
    if (this.defaultCode[language]) {
      this.value = this.defaultCode[language];
    }
    console.log(`[Editor] Lenguaje cambiado a: ${language}`);
  }

  ejecutarCodigo(): void {
    this.resultado = '';
    this.cargando = true;
    this.resultadoOk = false;

    this.executionService.connect(
      (message) => {
        if (message.type === 'connected') {
          this.executionService.runCode(this.language, this.value);
        }

        if (message.type === 'started') {
          this.resultado += 'Ejecución iniciada...\n';
        }

        if (message.type === 'output') {
          this.resultado += message.data;
        }

        if (message.type === 'error') {
          this.resultado += '\nError: ' + message.data;
          this.cargando = false;
          this.resultadoOk = false;
        }

        if (message.type === 'timeout') {
          this.resultado += '\n' + message.data;
          this.cargando = false;
          this.resultadoOk = false;
        }

        if (message.type === 'finished') {
          this.cargando = false;
          this.resultadoOk = message.exitCode === 0;
          this.resultado += `\nProceso finalizado con código ${message.exitCode}`;
          this.executionService.disconnect();
        }

        this.cdr.detectChanges();
      },
      () => {
        this.resultado = 'No se pudo conectar con el servicio de ejecución.';
        this.cargando = false;
        this.cdr.detectChanges();
      },
      () => {
        this.cargando = false;
        this.cdr.detectChanges();
      },
    );
  }

  enviarEntrada(input: string): void {
    if (!input.trim()) return;

    this.resultado += input + '\n';
    this.executionService.sendInput(input);
    this.cdr.detectChanges();
  }

  startResize(event: MouseEvent): void {
    this.isResizing = true;
    this.startY = event.clientY;
    this.startHeight = this.terminalHeight;

    document.addEventListener('mousemove', this.onResize);
    document.addEventListener('mouseup', this.stopResize);
  }

  onResize = (event: MouseEvent): void => {
    if (!this.isResizing) return;

    const delta = this.startY - event.clientY;
    const newHeight = this.startHeight + delta;

    if (newHeight >= 120 && newHeight <= 600) {
      this.terminalHeight = newHeight;
      this.cdr.detectChanges();
    }
  };

  stopResize = (): void => {
    this.isResizing = false;
    document.removeEventListener('mousemove', this.onResize);
    document.removeEventListener('mouseup', this.stopResize);
  };
}


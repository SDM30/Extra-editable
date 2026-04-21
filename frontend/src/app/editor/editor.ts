// editor.ts
import { ChangeDetectorRef, Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
import { CodeMirrorLspService } from '../codemirror-lsp-service';

export type Theme = 'light' | 'dark' | Extension;

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [Header, CodeSection],
  templateUrl: './editor.html',
  styleUrls: ['./editor.css'],
})
export class Editor implements OnInit, OnDestroy {
  // Código por defecto según lenguaje
  private defaultCode: Record<string, string> = {
    cpp: `#include <iostream>\n\nint main() {\n    std::cout << "Hola C++" << std::endl;\n    return 0;\n}`,
    python: `def hello():\n    print("Hello, World!")\n\nif __name__ == "__main__":\n    hello()`,
    typescript: `function greet(name: string): string {\n    return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("World"));`,
    javascript: `function greet(name) {\n    return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("World"));`
  };

  value = this.defaultCode['cpp'];
  theme: Theme = 'dark';
  language: string = 'cpp';
  
  // NUEVO: Identificador del proyecto (puede venir de la URL o usuario)
  projectId: string = 'proyecto-demo';
  
  // NUEVO: Flag para habilitar/deshabilitar LSP
  lspEnabled: boolean = true;

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

  resultado?: string;
  resultadoOk?: boolean;
  cargando = false;

  constructor(
    private executionService: ExecutionService,
    private cdr: ChangeDetectorRef,
    private collab: CollabService,  
    private auth: AuthService,
    private lspService: CodeMirrorLspService,
    private route: ActivatedRoute,
  ) {}

  async ngOnInit() {
    // Leer projectId de URL query parameters o usar default
    this.route.queryParams.subscribe(params => {
      this.projectId = params['projectId'] || 'proyecto-demo';
      console.log(`[Editor] Project ID: ${this.projectId}`);
    });

    const { token, username } = await this.auth.getCollabToken();
    this.collab.connect('room-editor-1', token, username);
  }

  ngOnDestroy(): void {
    // NUEVO: Limpiar sesión LSP al destruir el componente
    if (this.lspEnabled) {
      this.lspService.shutdownProject(this.projectId).catch(console.error);
    }
  }

  // NUEVO: Manejar cambio de lenguaje
  onLanguageChange(language: string) {
    this.language = language;
    
    // Actualizar código por defecto según lenguaje
    if (this.defaultCode[language]) {
      this.value = this.defaultCode[language];
    }
    
    console.log(`[Editor] Lenguaje cambiado a: ${language}`);
  }

  onRunCode() {
    this.resultado = undefined;
    this.resultadoOk = undefined;
    this.cargando = true;
    this.executionService
      .runCode(this.value)
      .pipe(
        timeout(10000),
        finalize(() => {
          this.cargando = false;
          this.cdr.detectChanges();
        }),
      )
      .subscribe({
        next: (resp) => {
          const resultadoLimpio = this.limpiarResultado(resp.resultado ?? 'Respuesta recibida');
          this.resultadoOk = this.extraerEstadoOk(resultadoLimpio);
          this.resultado = this.formatearSalida(resultadoLimpio, resp.tiempo);
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.resultadoOk = false;
          if (err?.name === 'TimeoutError') {
            this.resultado = 'Error: timeout esperando respuesta del backend';
          } else {
            this.resultado = 'Error: ' + (err?.message ?? err?.status ?? err);
          }
          this.cdr.detectChanges();
        },
      });
  }

  private limpiarResultado(resultado: string): string {
    return resultado.replace(/^id\s*=\s*[^|]*\|\s*/i, '');
  }

  private extraerEstadoOk(resultado: string): boolean | undefined {
    const match = resultado.match(/(^|\n)\s*ok\s*=\s*(true|false)\s*(\n|$)/i);
    if (!match) {
      return undefined;
    }
    return match[2].toLowerCase() === 'true';
  }

  private formatearSalida(resultado: string, tiempo?: string): string {
    return `${resultado}\ntiempo=${tiempo ?? 'N/A'}`;
  }
}
/**
 * editor.ts
 *
 * Componente principal del editor de código con soporte para múltiples lenguajes.
 *
 * Responsabilidades:
 * 1. Orquestar la interfaz del editor (CodeMirror)
 * 2. Gestionar cambios de lenguaje y tema
 * 3. Integrar Language Server Protocol (LSP) para asistencia de código
 * 4. Integrar ejecución de código via ExecutionService
 * 5. Integrar edición colaborativa via CollabService
 * 6. Limpiar recursos al destruir
 *
 * Lenguajes soportados: Python, C++, TypeScript, JavaScript
 *
 * @module editor/editor
 * @component
 * @standalone
 * @dependencies CodeMirrorLspService, ExecutionService, CollabService, AuthService
 */
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
import { CodeMirrorLspService } from '../services/codemirror-lsp-service';

export type Theme = 'light' | 'dark' | Extension;

/**
 * Componente Editor de Código Angular
 *
 * Proporciona una interfaz completa para editar y ejecutar código en múltiples lenguajes.
 *
 * Propiedades principales:
 * - `value`: Código actual en el editor
 * - `language`: Lenguaje de programación seleccionado
 * - `theme`: Tema visual del editor
 * - `lspEnabled`: Flag para habilitar/deshabilitar integración LSP
 * - `resultado`: Resultado de la ejecución del código
 * - `cargando`: Flag para mostrar estado de carga durante ejecución
 *
 * @class Editor
 * @implements {OnInit, OnDestroy}
 * **/
@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [Header, CodeSection],
  templateUrl: './editor.html',
  styleUrl: './editor.css',
})
export class Editor implements OnInit, OnDestroy {
  // Código por defecto según lenguaje
  private defaultCode: Record<string, string> = {
    cpp: `#include <iostream>\n\nint main() {\n    std::cout << "Hola C++" << std::endl;\n    return 0;\n}`,
    python: `def hello():\n    print("Hello, World!")\n\nif __name__ == "__main__":\n    hello()`,
    typescript: `function greet(name: string): string {\n    return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("World"));`,
    javascript: `function greet(name) {\n    return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("World"));`,
  };

  value = this.defaultCode['typescript'];
  theme: Theme = 'dark';
  language: string = 'typescript';

  // NUEVO: Identificador del proyecto (puede venir de la URL o usuario)
  projectId: string = 'proyecto-demo';

  // NUEVO: Flag para habilitar/deshabilitar LSP
  lspEnabled: boolean = true;

  // TODO: Colocar solo un tema oscuro y claro
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

  // TODO: El lenguaje solo se deberia elegir al crear el proyecto, no cambiarlo dinamicamente
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

  /**
   * Hook del ciclo de vida Angular - Inicializa el componente
   *
   * Realiza:
   * 1. Lee projectId de los query parameters de la URL (o usa 'proyecto-demo')
   * 2. Obtiene token y username para colaboración
   * 3. Conecta al servicio de colaboración
   *
   * @async
   * @returns {Promise<void>}
   *
   * @example
   * // URL: http://localhost:4200/editor?projectId=mi-proyecto
   * // Se conectará al proyecto 'mi-proyecto'
   */
  async ngOnInit() {
    // Leer projectId de URL query parameters o usar default
    this.route.queryParams.subscribe((params) => {
      this.projectId = params['projectId'] || 'proyecto-demo';
      console.log(`[Editor] Project ID: ${this.projectId}`);
    });

    const { token, username } = await this.auth.getCollabToken();
    this.collab.connect('room-editor-1', token, username);
  }

  /**
   * Hook del ciclo de vida Angular - Limpia recursos al destruir el componente
   *
   * Realiza:
   * 1. Si LSP está habilitado, cierra todas las sesiones del proyecto
   * 2. Libera conexiones WebSocket y contenedores Docker
   *
   * @returns {void}
   */
  ngOnDestroy(): void {
    // NUEVO: Limpiar sesión LSP al destruir el componente
    if (this.lspEnabled) {
      this.lspService.shutdownProject(this.projectId).catch(console.error);
    }
  }

  // NUEVO: Manejar cambio de lenguaje
  /**
   * Maneja cambio de lenguaje de programación
   *
   * Realiza:
   * 1. Actualiza el lenguaje actual
   * 2. Carga el código por defecto para ese lenguaje
   *
   * TODO: Debería reinicializar la sesión LSP cuando cambia el lenguaje.
   * Actualmente solo cambia el código sin actualizar el servidor LSP.
   *
   * @param {string} language - Lenguaje a usar (python, cpp, typescript, javascript)
   * @returns {void}
   *
   * @example
   * onLanguageChange('python'); // Carga código Python por defecto
   */
  onLanguageChange(language: string) {
    this.language = language;

    // Actualizar código por defecto según lenguaje
    if (this.defaultCode[language]) {
      this.value = this.defaultCode[language];
    }

    console.log(`[Editor] Lenguaje cambiado a: ${language}`);
  }

  /**
   * Ejecuta el código actual
   *
   * Realiza:
   * 1. Llama a ExecutionService para ejecutar el código
   * 2. Muestra resultado y tiempo de ejecución
   * 3. Extrae estado "ok" del resultado si está disponible
   * 4. Maneja timeout de 10 segundos
   *
   * @returns {void}
   *
   * @example
   * onRunCode();
   * // Muestra en 'resultado': "Hello World\ntiempo=1.234s"
   */
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

  /**
   * Limpia el resultado eliminando prefijo 'id='
   *
   * @private
   * @param {string} resultado - Resultado raw del ejecutor
   * @returns {string} Resultado limpio
   */
  private limpiarResultado(resultado: string): string {
    return resultado.replace(/^id\s*=\s*[^|]*\|\s*/i, '');
  }

  /**
   * Extrae el estado "ok" del resultado si existe
   *
   * Busca patrón: "ok = true" o "ok = false"
   *
   * @private
   * @param {string} resultado - Resultado procesado
   * @returns {boolean|undefined} true/false si se encuentra, undefined si no
   */
  private extraerEstadoOk(resultado: string): boolean | undefined {
    const match = resultado.match(/(^|\n)\s*ok\s*=\s*(true|false)\s*(\n|$)/i);
    if (!match) {
      return undefined;
    }
    return match[2].toLowerCase() === 'true';
  }

  /**
   * Formatea la salida añadiendo tiempo de ejecución
   *
   * @private
   * @param {string} resultado - Resultado del código
   * @param {string} [tiempo] - Tiempo de ejecución (opcional)
   * @returns {string} Salida formateada
   */
  private formatearSalida(resultado: string, tiempo?: string): string {
    return `${resultado}\ntiempo=${tiempo ?? 'N/A'}`;
  }
}

/**
 * code-section.ts
 *
 * Componente CodeSection que envuelve el editor CodeMirror e integra soporte para LSP.
 *
 * Responsabilidades:
 * 1. Renderizar el editor CodeMirror con el lenguaje especificado
 * 2. Gestionar cambios en el código y emitir eventos
 * 3. Integrar Language Server Protocol (LSP) para asistencia de código
 * 4. Manejar cambios de lenguaje, tema y proyecto
 * 5. Sincronizar cambios entre el componente padre (editor.ts) y CodeMirror
 *
 * @module editor/code-section/code-section
 * @component
 * @standalone
 * @dependencies CodeMirrorLspService
 */
import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ViewChild,
  AfterViewInit,
  OnChanges,
  SimpleChanges,
  ChangeDetectorRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CodeEditor } from '@acrodata/code-editor';
import { EditorView } from '@codemirror/view';
import { Extension, EditorState } from '@codemirror/state';
import { autocompletion } from '@codemirror/autocomplete';
import { yCollab } from 'y-codemirror.next';
import { Subscription } from 'rxjs';
import * as Y from 'yjs';

import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';

import { CodeMirrorLspService } from '../../services/codemirror-lsp-service';
import { CollabService } from '../../services/collab.service';

/**
 * Tipo de tema del editor
 *
 * @typedef {('light'|'dark'|Extension)} Theme
 * - 'light': Tema claro predefinido
 * - 'dark': Tema oscuro predefinido
 * - Extension: Extensión personalizada de CodeMirror
 */
export type Theme = 'dark' | 'light' | Extension;

@Component({
  selector: 'app-code-section',
  standalone: true,
  imports: [FormsModule, CodeEditor],
  templateUrl: './code-section.html',
  styleUrl: './code-section.css',
})
/**
 * Componente CodeSection - Sección del editor de código
 *
 * Renderiza un editor CodeMirror con soporte para múltiples lenguajes y
 * Language Server Protocol (LSP) para proporcionar:
 * - Diagnósticos de código (errores, warnings)
 * - Autocompletado inteligente
 * - Sincronización con el servidor LSP
 *
 * Ciclo de vida:
 * 1. ngOnInit: Inicializa el componente
 * 2. AfterViewInit (100ms después): Obtiene referencia a EditorView e inicializa LSP
 * 3. ngOnChanges: Reinicializa LSP si cambia lenguaje, proyecto o estado LSP
 * 4. ngOnDestroy: Limpia sesiones LSP
 *
 * @class CodeSection
 * @implements {OnInit, OnDestroy, AfterViewInit, OnChanges}
 *
 * @example
 * <app-code-section
 *   [value]="code"
 *   (valueChange)="code = $event"
 *   [language]="'python'"
 *   [projectId]="'my-project'"
 *   [lspEnabled]="true"
 *   [theme]="'dark'"
 * ></app-code-section>
 */
export class CodeSection implements OnInit, OnDestroy, AfterViewInit, OnChanges {
  /**
   * Referencia al componente CodeEditor (envoltorio de CodeMirror)
   * @private
   * @type {CodeEditor}
   */
  @ViewChild(CodeEditor) codeEditor!: CodeEditor;

  // ============== INPUT: Contenido del Editor ==============

  /**
   * Contenido actual del código en el editor
   *
   * @type {string}
   * @default ''
   *
   * @example
   * value = "def hello():\n    print('Hello')"
   */
  private _value = '';
  @Input() set value(val: string) {
    this._value = val;
  }
  get value(): string {
    return this._value;
  }

  /**
   * Emite cuando el usuario cambia el contenido del editor
   *
   * @type {EventEmitter<string>}
   *
   * @example
   * (valueChange)="onCodeChange($event)"
   */
  @Output() valueChange = new EventEmitter<string>();

  // ============== INPUT: Estilos y Lenguaje ==============

  /**
   * Tema de colores del editor
   *
   * Puede ser un tema predefinido ('light', 'dark') o una extensión de CodeMirror personalizada
   *
   * @type {Theme}
   * @default 'dark'
   *
   * @example
   * [theme]="'dark'" // Tema oscuro
   * [theme]="oneDark" // Extensión personalizada
   */
  @Input() theme: Theme = 'dark';

  /**
   * Lenguaje de programación actual
   *
   * Valores soportados: 'python', 'cpp', 'typescript', 'javascript'
   * Determina:
   * - Syntax highlighting
   * - Servidor LSP a usar
   * - Extensión de archivo
   *
   * @type {string}
   * @default 'python'
   *
   * @example
   * [language]="'python'" // Editor Python con pylsp
   */
  @Input() language: string = 'cpp';

  // ============== INPUT: Configuración LSP ==============

  /**
   * ID único del proyecto
   *
   * Se utiliza para:
   * - Crear/recuperar contenedor Docker LSP
   * - Reutilizar sesiones LSP existentes
   * - Asociar archivos con el proyecto
   *
   * @type {string}
   * @default 'default-project'
   *
   * @example
   * [projectId]="'my-project-123'"
   */
  @Input() projectId: string = 'default-project';

  /**
   * Ruta base del archivo sin extensión
   *
   * Se combina con la extensión del lenguaje para formar la ruta completa
   * del archivo en el contenedor LSP
   *
   * @type {string}
   * @default 'main'
   *
   * @example
   * [filePath]="'app'" → "app.py" para Python
   */
  @Input() filePath: string = 'main';

  /**
   * Habilita o deshabilita el soporte de Language Server Protocol
   *
   * Si es true:
   * - Se inicializa sesión LSP
   * - Se muestran diagnósticos
   * - Se activa autocompletado inteligente
   *
   * Si es false:
   * - Solo syntax highlighting básico
   * - Autocompletado genérico (sin contexto)
   *
   * @type {boolean}
   * @default true
   *
   * @example
   * [lspEnabled]="true" // Habilitar LSP
   */
  @Input() lspEnabled: boolean = true;

  // ============== INPUT: Estado de Ejecución ==============

  /**
   * Resultado de la última ejecución de código
   *
   * Se muestra en la sección de problemas/resultados debajo del editor
   *
   * @type {string|undefined}
   *
   * @example
   * [resultado]="'Hello World'"
   */
  @Input() resultado?: string;

  /**
   * Indica si la ejecución anterior fue exitosa (true) o falló (false)
   *
   * Se usa para estilizar el mensaje de resultado
   *
   * @type {boolean|undefined}
   *
   * @example
   * [resultadoOk]="true"
   */
  @Input() resultadoOk?: boolean;

  /**
   * Indica si el código se está ejecutando actualmente
   *
   * @type {boolean}
   * @default false
   *
   * @example
   * [cargando]="true" // Mostrar spinner de carga
   */
  @Input() cargando: boolean = false;

  @Input() terminalHeight: number = 220;
  @Output() resizeStart = new EventEmitter<MouseEvent>();

  // panel del problema
  // ============== STATE: Propiedades Internas ==============

  /**
   * Control de visibilidad de la sección de problemas/resultados
   * @private
   * @type {boolean}
   */
  isProblemCollapsed = false;

  /**
   * Referencia a la instancia de EditorView de CodeMirror
   * @private
   * @type {EditorView|null}
   */
  private editorView: EditorView | null = null;

  /**
   * Array de extensiones LSP (linting, autocompletado, etc.)
   * @private
   * @type {Extension[]}
   */
  private lspExtensions: Extension[] = [];

  /**
   * Extensiones de colaboración (Yjs + cursores remotos)
   * @private
   */
  private collabExtensions: Extension[] = [];
  private collabUndoManager: Y.UndoManager | null = null;

  /**
   * Cache de la extensión de lenguaje para evitar crear nuevas instancias en cada getter
   * CodeMirror compara por identidad de objetos.
   */
  private languageExt: Extension | null = null;

  private collabReadySub: Subscription | null = null;

  /**
   * Ruta completa del archivo actualmente conectado a LSP
   * Se usa para desconectar LSP cuando cambia el lenguaje
   * @private
   * @type {string|null}
   */
  private lspAttachedPath: string | null = null;

  /**
   * Número secuencial para detectar inicializaciones obsoletas de LSP
   * Evita que requests de LSP anteriores interfieran con iniciailizaciones nuevas
   * @private
   * @type {number}
   */
  private lspInitSeq = 0;

  /**
   * Constructor del componente
   *
   * @param {CodeMirrorLspService} lspIntegration - Servicio de integración LSP
   */
  constructor(
    private lspIntegration: CodeMirrorLspService,
    private collab: CollabService,
    private cdr: ChangeDetectorRef,
  ) {}

  /**
   * Hook del ciclo de vida Angular - Inicializa el componente
   *
   * Registra información del componente para debugging
   *
   * @returns {void}
   */
  ngOnInit(): void {
    console.log(
      `[CodeSection] Init - Proyecto: ${this.projectId}, Lenguaje: ${this.language}, LSP: ${this.lspEnabled}`,
    );
  }

  /**
   * Hook del ciclo de vida Angular - Después de inicializar la vista
   *
   * Con un delay de 100ms:
   * 1. Obtiene la referencia a EditorView de CodeMirror
   * 2. Si LSP está habilitado, inicializa la sesión LSP
   *
   * El delay es necesario para asegurar que el componente CodeEditor
   * haya terminado de renderizar y tenga la instancia de EditorView lista.
   *
   * @returns {void}
   */
  ngAfterViewInit(): void {
    setTimeout(() => {
      this.editorView = (this.codeEditor as any).view;

      // Inicializar binding colaborativo cuando el provider esté listo.
      // (CollabService emite ready$ en onConnect del provider)
      this.collabReadySub?.unsubscribe();
      this.collabReadySub = this.collab.ready$.subscribe(() => this.initializeCollab());
      // Si el provider ya está sincronizado al montar, inicializar ahora.
      if (this.collab.getProvider() && (this.collab as any).isReady && (this.collab as any).isReady()) {
        this.initializeCollab();
      }

      if (this.editorView && this.lspEnabled) {
        this.initializeLSP();
      }
    }, 100);
  }

  /**
   * Hook del ciclo de vida Angular - Detecta cambios en inputs
   *
   * Si cambian lenguaje, proyecto o estado de LSP:
   * 1. Desconecta LSP anterior (si estaba conectado)
   * 2. Si LSP está deshabilitado, limpia extensiones
   * 3. Si LSP está habilitado, reinicializa con nueva configuración
   *
   * Esto permite cambiar dinámicamente de lenguaje o proyecto sin perder
   * la referencia al EditorView.
   *
   * @param {SimpleChanges} changes - Cambios detectados en los inputs
   * @returns {void}
   */
  ngOnChanges(changes: SimpleChanges): void {
    const languageChanged = Boolean(changes['language']);
    const projectChanged = Boolean(changes['projectId']);
    const lspToggled = Boolean(changes['lspEnabled']);

    if (!languageChanged && !projectChanged && !lspToggled) return;
    if (!this.editorView) return;

    // Limpiar cache de la extensión de lenguaje si cambió el lenguaje
    if (languageChanged) this.languageExt = null;

    if (!this.lspEnabled) {
      if (this.lspAttachedPath) {
        this.lspIntegration.detachLSP(this.lspAttachedPath);
        this.lspAttachedPath = null;
      }
      this.lspExtensions = [];
      return;
    }

    // Re-inicializar LSP cuando cambia el lenguaje o el proyecto.
    this.initializeLSP();
  }

  /**
   * Hook del ciclo de vida Angular - Limpia recursos
   *
   * Al destruir el componente:
   * 1. Si LSP está habilitado, desconecta el archivo actual
   * 2. Libera referencias para que el recolector de basura las elimine
   *
   * @returns {void}
   */
  ngOnDestroy(): void {
    this.collabReadySub?.unsubscribe();
    this.collabReadySub = null;
    this.collabUndoManager?.destroy();
    this.collabUndoManager = null;

    if (this.lspEnabled) {
      const fullPath = this.lspAttachedPath ?? this.getFullPath();
      this.lspIntegration.detachLSP(fullPath);
    }
  }

  private async initializeCollab(): Promise<void> {
    if (!this.editorView) return;
    if (this.collabExtensions.length > 0) return;

    const shared = this.collab.getSharedText('codemirror');
    const provider = this.collab.getProvider();
    const awareness = provider?.awareness;

    if (!shared || !awareness) return;

    // Normalizar saltos de línea para evitar desalineaciones CRLF/LF
    const localText = this.editorView.state.doc.toString().replace(/\r\n/g, '\n');

    try {
      const sharedText = shared.toString();

      // Si ya existe contenido remoto, hidratar el editor local desde el Y.Text
      // compartido antes de adjuntar yCollab. Así un tab nuevo arranca con el
      // documento real en vez del texto predeterminado del componente.
      if (sharedText.length > 0 && sharedText !== localText) {
        this._value = sharedText;
        this.cdr.detectChanges();
      }
    } catch (e) {
      console.warn('[CodeSection] Error comprobando/inicializando shared text:', e);
    }

    this.collabUndoManager = new Y.UndoManager(shared);
    // yCollab incluye sincronización (ySync) + cursores remotos (awareness).
    this.collabExtensions = [yCollab(shared, awareness, { undoManager: this.collabUndoManager })];

    // El provider se conecta fuera del zone de Angular; forzar update para que
    // `code-editor` reciba las nuevas extensiones.
    this.cdr.detectChanges();
  }

  /**
   * Inicializa la sesión LSP para el editor actual
   *
   * Proceso:
   * 1. Valida que EditorView esté disponible
   * 2. Incrementa el número de secuencia para detectar inicializaciones obsoletas
   * 3. Desconecta LSP anterior si existía
   * 4. Solicita extensiones LSP al CodeMirrorLspService
   * 5. Valida que no haya habido un cambio de lenguaje mientras se inicializaba
   * 6. Almacena la ruta completa del archivo conectado a LSP
   * 7. Registra el éxito en la consola
   *
   * Nota: Si hay error, desactiva LSP para evitar bucles de reintentos.
   *
   * @async
   * @private
   * @returns {Promise<void>}
   */
  private async initializeLSP(): Promise<void> {
    if (!this.editorView) return;

    try {
      const seq = ++this.lspInitSeq;

      // Detach previo si existía (evita mezclar lenguajes en el mismo projectId)
      if (this.lspAttachedPath) {
        this.lspIntegration.detachLSP(this.lspAttachedPath);
        this.lspAttachedPath = null;
      }
      this.lspExtensions = [];

      this.lspExtensions = await this.lspIntegration.attachLSPToEditor(
        this.projectId,
        this.mapLanguageToLSP(this.language),
        this.editorView,
        this.filePath,
      );

      if (seq !== this.lspInitSeq) return;
      this.lspAttachedPath = this.getFullPath();

      // Re-crear el editor con las nuevas extensiones
      this.editorView.dispatch({
        effects: [
          // Las extensiones ya están aplicadas por CodeMirror
        ],
      });

      console.log(
        '[CodeSection] ✅ LSP inicializado con',
        this.lspExtensions.length,
        'extensiones',
      );
    } catch (error) {
      console.error('[CodeSection] ❌ Error inicializando LSP:', error);
      this.lspEnabled = false;
    }
  }

  /**
   * Convierte el nombre del lenguaje de CodeMirror al formato de servidor LSP
   *
   * Mapeo de lenguajes:
   * - 'typescript' → 'typescript' (TypeScript LSP)
   * - 'javascript' → 'typescript' (Usa TypeScript LSP para JavaScript)
   * - 'python' → 'python' (Python LSP)
   * - 'cpp' → 'cpp' (C++ LSP)
   * - otros → devuelve el lenguaje sin cambios
   *
   * @private
   * @param {string} lang - Nombre del lenguaje en CodeMirror
   * @returns {string} Nombre del servidor LSP
   */
  private mapLanguageToLSP(lang: string): string {
    const mapping: Record<string, string> = {
      cpp: 'cpp',
      python: 'python',
      typescript: 'typescript',
      javascript: 'typescript', // JavaScript usa TypeScript LSP
    };
    return mapping[lang] || lang;
  }

  /**
   * Construye la ruta completa del archivo incluyendo extensión
   *
   * Combina el filePath base con la extensión correspondiente al lenguaje actual.
   *
   * Mapeo de extensiones:
   * - 'python' → '.py'
   * - 'cpp' → '.cpp'
   * - 'typescript' → '.ts'
   * - 'javascript' → '.js'
   * - otros → '.txt'
   *
   * Ejemplo: 'main' + Python → 'main.py'
   *
   * @private
   * @returns {string} Ruta completa del archivo (ej: 'main.py')
   */
  private getFullPath(): string {
    const extensions: Record<string, string> = {
      cpp: '.cpp',
      python: '.py',
      typescript: '.ts',
      javascript: '.js',
    };
    const ext = extensions[this.language] || '.txt';
    return `${this.filePath}${ext}`;
  }

  /**
   * Maneja cambios en el valor del editor
   *
   * Actualiza la propiedad interna _value y emite el evento valueChange
   * para que el componente padre (editor.ts) se entere de los cambios.
   *
   * @param {string} newValue - Nuevo contenido del editor
   * @returns {void}
   */
  onValueChange(newValue: string) {
    this._value = newValue;
    this.valueChange.emit(newValue);
  }

  /**
   * Alterna la visibilidad de la sección de problemas/resultados
   *
   * Cambia el estado de isProblemCollapsed para mostrar/ocultar
   * la sección de diagnósticos y resultados de ejecución.
   *
   * @returns {void}
   */
  toggleProblem(): void {
    this.isProblemCollapsed = !this.isProblemCollapsed;
  }

  /**
   * Getter que retorna todas las extensiones de CodeMirror a aplicar
   *
   * Construye el array de extensiones incluyendo:
   * 1. Extensión de sintaxis del lenguaje (cpp, python, javascript)
   * 2. Extensiones LSP si están disponibles (linting, autocompletado inteligente)
   * 3. O autocompletado genérico si LSP no está disponible
   *
   * Nota: Solo se usa UNA extensión de autocompletado para evitar conflictos:
   * - Si LSP está listo, su autocompletado tiene contexto del servidor
   * - Si no, usa el autocompletado genérico de CodeMirror
   *
   * @readonly
   * @returns {Extension[]} Array de extensiones para CodeMirror
   */
  get editorExtensions(): Extension[] {
    const extensions: Extension[] = [this.languageExtension()];

    // Usar solo UNA extensión de autocompletado:
    // - si LSP está listo, viene incluido dentro de `lspExtensions`
    // - si no, usar el autocompletado default
    if (this.lspExtensions.length > 0) {
      extensions.push(...this.lspExtensions);
    } else {
      extensions.push(autocompletion());
    }

    // Colaboración (cursores remotos + sync doc)
    if (this.collabExtensions.length > 0) {
      extensions.push(...this.collabExtensions);
    }

    return extensions;
  }

  /**
   * Obtiene la extensión de sintaxis para el lenguaje actual
   *
   * Retorna la extensión de CodeMirror correspondiente para:
   * - C++ (cpp)
   * - Python (python)
   * - TypeScript y JavaScript (javascript - ambos usan la misma extensión)
   *
   * @private
   * @returns {Extension} Extensión de CodeMirror para el lenguaje actual
   */
  private languageExtension(): Extension {
    if (this.languageExt) return this.languageExt;

    let ext: Extension;
    switch (this.language) {
      case 'cpp':
        ext = cpp();
        break;
      case 'typescript':
      case 'javascript':
        ext = javascript();
        break;
      case 'python':
        ext = python();
        break;
      default:
        ext = cpp();
    }

    this.languageExt = ext;
    return ext;
  }

  @Output() inputSend = new EventEmitter<string>();

  entradaUsuario = '';

  enviarEntrada(): void {
    const entrada = this.entradaUsuario;

    if (!entrada.trim()) return;

    this.inputSend.emit(entrada);
    this.entradaUsuario = '';
  }
}

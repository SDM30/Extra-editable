// code-section.ts
import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CodeEditor } from '@acrodata/code-editor';
import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { autocompletion } from '@codemirror/autocomplete';

import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';

import { CodeMirrorLspService } from '../../codemirror-lsp-service';

export type Theme = 'light' | 'dark' | Extension;

@Component({
  selector: 'app-code-section',
  standalone: true,
  imports: [FormsModule, CodeEditor],
  templateUrl: './code-section.html',
  styleUrl: './code-section.css',
})
export class CodeSection implements OnInit, OnDestroy, AfterViewInit, OnChanges {
  @ViewChild(CodeEditor) codeEditor!: CodeEditor;
  
  private _value = '';
  @Input() set value(val: string) {
    this._value = val;
  }
  get value(): string {
    return this._value;
  }
  @Output() valueChange = new EventEmitter<string>();
  @Input() theme: Theme = 'light';

  @Input() language: string = 'python';
  @Input() projectId: string = 'default-project';
  @Input() filePath: string = 'main';
  @Input() lspEnabled: boolean = true;
  @Input() resultado?: string;
  @Input() resultadoOk?: boolean;
  @Input() cargando: boolean = false;

  isProblemCollapsed = false;
  private editorView: EditorView | null = null;
  private lspExtensions: Extension[] = [];
  private lspAttachedPath: string | null = null;
  private lspInitSeq = 0;

  constructor(private lspIntegration: CodeMirrorLspService) {}

  ngOnInit(): void {
    console.log(`[CodeSection] Init - Proyecto: ${this.projectId}, Lenguaje: ${this.language}, LSP: ${this.lspEnabled}`);
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.editorView = (this.codeEditor as any).view;
      
      if (this.editorView && this.lspEnabled) {
        this.initializeLSP();
      }
    }, 100);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const languageChanged = Boolean(changes['language']);
    const projectChanged = Boolean(changes['projectId']);
    const lspToggled = Boolean(changes['lspEnabled']);

    if (!languageChanged && !projectChanged && !lspToggled) return;
    if (!this.editorView) return;

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

  ngOnDestroy(): void {
    if (this.lspEnabled) {
      const fullPath = this.lspAttachedPath ?? this.getFullPath();
      this.lspIntegration.detachLSP(fullPath);
    }
  }

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
        this.filePath
      );

      if (seq !== this.lspInitSeq) return;
      this.lspAttachedPath = this.getFullPath();
      
      // Re-crear el editor con las nuevas extensiones
      this.editorView.dispatch({
        effects: [
          // Las extensiones ya están aplicadas por CodeMirror
        ]
      });
      
      console.log('[CodeSection] ✅ LSP inicializado con', this.lspExtensions.length, 'extensiones');
    } catch (error) {
      console.error('[CodeSection] ❌ Error inicializando LSP:', error);
      this.lspEnabled = false;
    }
  }

  // Mapear lenguaje de CodeMirror al formato LSP
  private mapLanguageToLSP(lang: string): string {
    const mapping: Record<string, string> = {
      'cpp': 'cpp',
      'python': 'python',
      'typescript': 'typescript',
      'javascript': 'typescript'  // JavaScript usa TypeScript LSP
    };
    return mapping[lang] || lang;
  }

  private getFullPath(): string {
    const extensions: Record<string, string> = {
      'cpp': '.cpp',
      'python': '.py',
      'typescript': '.ts',
      'javascript': '.js'
    };
    const ext = extensions[this.language] || '.txt';
    return `${this.filePath}${ext}`;
  }

  onValueChange(newValue: string) {
    this._value = newValue;
    this.valueChange.emit(newValue);
  }

  toggleProblem(): void {
    this.isProblemCollapsed = !this.isProblemCollapsed;
  }

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
    
    return extensions;
  }

  private languageExtension(): Extension {
    switch (this.language) {
      case 'cpp':
        return cpp();
      case 'typescript':
      case 'javascript':
        return javascript();
      case 'python':
        return python();
      default:
        return python();
    }
  }
}

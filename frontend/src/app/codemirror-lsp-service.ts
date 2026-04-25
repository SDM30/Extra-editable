// app/services/codemirror-lsp.service.ts
import { Injectable } from '@angular/core';
import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { CompletionContext, CompletionResult, autocompletion } from '@codemirror/autocomplete';
import { forceLinting, linter, Diagnostic } from '@codemirror/lint';
import { LspService, LSPSession } from './lsp-service';

export interface LSPCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  insertText?: string;
  documentation?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CodeMirrorLspService {
  private sessions: Map<string, {session: LSPSession, version: number}> = new Map();
  private diagnostics: Map<string, Diagnostic[]> = new Map();

  constructor(private lspService: LspService) {}

  /**
   * Crea un listener para cambios en el editor
   */
  createUpdateListener(filePath: string, session: LSPSession): Extension {
    let updateTimeout: any;
    
    return EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const sessionInfo = this.sessions.get(filePath);
        if (sessionInfo) {
          sessionInfo.version++;
          const content = update.state.doc.toString();
          
          // Debounce para no saturar
          clearTimeout(updateTimeout);
          updateTimeout = setTimeout(() => {
            this.lspService.updateDocument(
              session, 
              filePath, 
              content, 
              sessionInfo.version
            );
          }, 300);
        }
      }
    });
  }

  /**
   * Inicializa el soporte LSP para un editor
   */
  async attachLSPToEditor(
    projectId: string,
    language: string,
    editorView: EditorView,
    filePath: string = 'main'
  ): Promise<Extension[]> {
    // Obtener sesión LSP
    const session = await this.lspService.initializeSession(projectId, language);
    
    // Mapear extensión de archivo según lenguaje
    const extension = this.getFileExtension(language);
    const fullPath = `${filePath}${extension}`;
    
    this.sessions.set(fullPath, { session, version: 1 });
    this.diagnostics.set(fullPath, []);

    // Obtener contenido inicial
    const content = editorView.state.doc.toString();

    // Crear extension de linting y listener de diagnósticos ANTES de didOpen
    // (algunos servidores envían publishDiagnostics inmediatamente tras abrir).
    const lintExt = this.createLintExtension(fullPath);
    this.setupDiagnosticListener(editorView, fullPath, lintExt);

    // Abrir documento en LSP
    this.lspService.openDocument(session, fullPath, content, language);

    // Crear listener para cambios
    const updateListener = this.createUpdateListener(fullPath, session);
    
    // Crear extension de autocompletado
    const completionExt = this.createCompletionExtension(fullPath);
    
    console.log(`[CodeMirror-LSP] LSP adjuntado a ${fullPath}`);
    
    // Retornar las extensions que necesitan ser añadidas al EditorView
    return [updateListener, completionExt, lintExt];
  }

  /**
   * Configura listener para diagnósticos
   */
  private setupDiagnosticListener(editorView: EditorView, filePath: string, lintExt: Extension): void {
    this.lspService.diagnostics$.subscribe(({ uri, diagnostics }) => {
      const expectedUri = `file:///workspace/${filePath}`;
      const matches = uri === expectedUri || uri.endsWith(`/${filePath}`) || uri.endsWith(filePath);

      if (!matches) {
        return;
      }

      if (uri !== expectedUri) {
        console.log(`[LSP] Diagnóstico recibido para uri=${uri} (esperado ${expectedUri})`);
      }

      if (diagnostics?.length) {
        const first = diagnostics[0];
        console.log('[LSP] Primer diagnóstico:', {
          message: first?.message,
          severity: first?.severity,
          start: first?.range?.start,
          end: first?.range?.end,
          docLines: editorView.state.doc.lines,
          docLength: editorView.state.doc.length
        });
      }

      const cmDiagnostics = diagnostics
        .map(d => {
          const from = this.positionToOffsetClamped(editorView, d.range.start);
          const to = this.positionToOffsetClamped(editorView, d.range.end);
          return {
            from,
            to: Math.max(from, to),
            severity: this.mapSeverity(d.severity),
            message: d.message
          } as Diagnostic;
        })

      this.diagnostics.set(filePath, cmDiagnostics);
      console.log(`[LSP] ${cmDiagnostics.length} diagnósticos actualizados para ${filePath}`);

      // Forzar reevaluación del linter para que tome los diagnósticos recién actualizados
      forceLinting(editorView);
    });
  }

  /**
   * Crea una extension de linting para CodeMirror
   */
  private createLintExtension(filePath: string): Extension {
    return linter((editorView) => {
      return this.diagnostics.get(filePath) || [];
    });
  }

  /**
   * Crea una extension de autocompletado para CodeMirror
   */
  private createCompletionExtension(filePath: string): Extension {
    return autocompletion({
      override: [this.createCompletionFunction(filePath)]
    });
  }

  /**
   * Función de autocompletado para CodeMirror
   */
  private createCompletionFunction(filePath: string) {
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      const sessionInfo = this.sessions.get(filePath);
      if (!sessionInfo) return null;

      const pos = context.pos;
      const line = context.state.doc.lineAt(pos);
      const lineNumber = line.number - 1;
      const character = pos - line.from;

      try {
        const items = await this.lspService.requestCompletion(
          sessionInfo.session,
          filePath,
          lineNumber,
          character
        );

        if (items.length === 0) return null;

        return {
          from: pos,
          options: items.map((item: any) => ({
            label: item.label,
            type: this.mapCompletionKind(item.kind),
            detail: item.detail,
            info: item.documentation,
            apply: item.insertText || item.label
          }))
        };
      } catch (e) {
        console.error('[LSP] Error en autocompletado:', e);
        return null;
      }
    };
  }

  /**
   * Desconecta LSP del editor
   */
  detachLSP(filePath: string): void {
    const sessionInfo = this.sessions.get(filePath);
    if (sessionInfo) {
      this.lspService.closeDocument(sessionInfo.session, filePath);
      this.sessions.delete(filePath);
    }
  }

  /**
   * Cierra completamente la sesión del proyecto
   */
  async shutdownProject(projectId: string): Promise<void> {
    // Cerrar todos los documentos del proyecto
    for (const [filePath, sessionInfo] of this.sessions.entries()) {
      if (sessionInfo.session.projectId === projectId) {
        this.lspService.closeDocument(sessionInfo.session, filePath);
        this.sessions.delete(filePath);
      }
    }
    
    await this.lspService.shutdownSession(projectId);
  }

  // Helpers
  private getFileExtension(language: string): string {
    const extensions: Record<string, string> = {
      'python': '.py',
      'cpp': '.cpp',
      'typescript': '.ts'
    };
    return extensions[language] || '.txt';
  }

  private positionToOffset(editorView: EditorView, pos: {line: number, character: number}): number {
    const line = editorView.state.doc.line(pos.line + 1);
    return line.from + pos.character;
  }

  private positionToOffsetClamped(editorView: EditorView, pos: { line: number, character: number }): number {
    const doc = editorView.state.doc;
    const lineNumber = Math.min(Math.max(1, (pos?.line ?? 0) + 1), doc.lines);
    const line = doc.line(lineNumber);
    const character = Math.min(Math.max(0, pos?.character ?? 0), line.length);
    return line.from + character;
  }

  private mapSeverity(severity: number): 'error' | 'warning' | 'info' {
    switch (severity) {
      case 1: return 'error';
      case 2: return 'warning';
      default: return 'info';
    }
  }

  private mapCompletionKind(kind: number): string {
    const kinds: Record<number, string> = {
      1: 'text', 2: 'method', 3: 'function', 4: 'constructor',
      5: 'field', 6: 'variable', 7: 'class', 8: 'interface',
      9: 'module', 10: 'property', 11: 'unit', 12: 'value',
      13: 'enum', 14: 'keyword', 15: 'snippet', 16: 'color',
      17: 'file', 18: 'reference', 19: 'folder', 20: 'enumMember',
      21: 'constant', 22: 'struct', 23: 'event', 24: 'operator',
      25: 'typeParameter'
    };
    return kinds[kind] || 'text';
  }

  async initializeSessionOnly(
    projectId: string,
    language: string,
    filePath: string,
    content: string
  ): Promise<void> {
    const session = await this.lspService.initializeSession(projectId, language);
    this.sessions.set(filePath, { session, version: 1 });
    this.lspService.openDocument(session, filePath, content, language);
  }
}

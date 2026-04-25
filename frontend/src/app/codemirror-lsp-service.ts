// app/services/codemirror-lsp.service.ts
import { Injectable } from '@angular/core';
import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { CompletionContext, CompletionResult, autocompletion, startCompletion } from '@codemirror/autocomplete';
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
  private sessions: Map<string, {
    session: LSPSession,
    version: number,
    lastSentVersion: number,
    lastSentAt: number,
    latestContent: string
  }> = new Map();
  private diagnostics: Map<string, Diagnostic[]> = new Map();

  constructor(private lspService: LspService) {}

  private flushDocumentChanges(filePath: string): void {
    const sessionInfo = this.sessions.get(filePath);
    if (!sessionInfo) return;

    if (sessionInfo.lastSentVersion === sessionInfo.version) return;

    const now = Date.now();
    // Evitar saturar el LSP con demasiados didChange en ráfaga
    if (now - sessionInfo.lastSentAt < 25) return;

    this.lspService.updateDocument(
      sessionInfo.session,
      filePath,
      sessionInfo.latestContent,
      sessionInfo.version
    );

    sessionInfo.lastSentVersion = sessionInfo.version;
    sessionInfo.lastSentAt = now;
  }

  /**
   * Crea un listener para cambios en el editor
   */
  createUpdateListener(filePath: string, session: LSPSession): Extension {
    let updateTimeout: any;
    let completionTimeout: any;
    
    return EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const sessionInfo = this.sessions.get(filePath);
        if (sessionInfo) {
          sessionInfo.version++;
          const content = update.state.doc.toString();
          sessionInfo.latestContent = content;

          // Autocompletado automático: fuerza apertura sin Ctrl+Space.
          // Algunos wrappers/configs desactivan activateOnTyping; esto lo evita manteniendo lógica simple.
          const head = update.state.selection.main.head;
          const prevChar = head > 0 ? update.state.doc.sliceString(head - 1, head) : '';

          const isTsJs = filePath.endsWith('.ts') || filePath.endsWith('.js');
          const isPython = filePath.endsWith('.py');
          const isCpp = (
            filePath.endsWith('.cpp') ||
            filePath.endsWith('.cc') ||
            filePath.endsWith('.cxx') ||
            filePath.endsWith('.hpp') ||
            filePath.endsWith('.h')
          );

          if (isTsJs || isPython || isCpp) {
            // Para Python, ser más conservador para evitar ruido:
            // - siempre en '.' (member access)
            // - o cuando el identificador actual tiene longitud >= 2
            const lookback = update.state.doc.sliceString(Math.max(0, head - 50), head);
            const currentIdent = (lookback.match(/[\w$]+$/) || [''])[0];

            const lastTwo = head > 1 ? update.state.doc.sliceString(head - 2, head) : '';
            const shouldTrigger =
              (prevChar === '.') ||
              (isTsJs && /[\w$.]/.test(prevChar)) ||
              (isPython && /[\w_]/.test(prevChar) && currentIdent.length >= 2) ||
              (isCpp && (
                prevChar === '.' ||
                prevChar === '>' || // para '->'
                lastTwo === '::' || // scope
                (/[A-Za-z_]/.test(prevChar) && currentIdent.length >= 2)
              ));

            if (shouldTrigger) {
              clearTimeout(completionTimeout);
              completionTimeout = setTimeout(() => {
                try {
                  // Asegurar que el LSP tenga el texto más reciente ANTES de pedir completion;
                  // si no, suele aparecer recién después (p.ej. al presionar backspace).
                  this.flushDocumentChanges(filePath);
                  startCompletion(update.view);
                } catch {
                  // ignore
                }
              }, isPython ? 120 : (isCpp ? 80 : 50));
            }
          }
          
          // Debounce para no saturar
          clearTimeout(updateTimeout);
          updateTimeout = setTimeout(() => {
            this.flushDocumentChanges(filePath);
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

    // Obtener contenido inicial
    const content = editorView.state.doc.toString();

    this.sessions.set(fullPath, {
      session,
      version: 1,
      lastSentVersion: 1,
      lastSentAt: Date.now(),
      latestContent: content
    });
    this.diagnostics.set(fullPath, []);

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
      override: [this.createCompletionFunction(filePath)],
      activateOnTyping: true,
      interactionDelay: 150
    });
  }

  /**
   * Función de autocompletado para CodeMirror
   */
  private createCompletionFunction(filePath: string) {
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      const sessionInfo = this.sessions.get(filePath);
      if (!sessionInfo) return null;

      // Mantener el LSP sincronizado para evitar completions vacíos al escribir rápido.
      this.flushDocumentChanges(filePath);

      const pos = context.pos;

      // Reducir requests al LSP: solo cuando hay contexto (explicit, identificador o member access).
      const memberAccess = context.matchBefore(/(\.|->|::)[\w_]*/);
      const identifier = context.matchBefore(/[\w_]+/);
      const hasContext = Boolean(memberAccess || identifier);
      if (!context.explicit && !hasContext) return null;

      // Calcular rango a reemplazar (sin incluir el '.')
      let from = pos;
      if (memberAccess) {
        const text = memberAccess.text || '';
        const opLen = text.startsWith('->') || text.startsWith('::') ? 2 : 1;
        from = memberAccess.from + opLen;
      } else if (identifier) {
        from = identifier.from;
      }

      // Evitar pedir completions por prefijos demasiado cortos (cuando no es explícito)
      const typed = context.state.sliceDoc(from, pos);
      if (!context.explicit && !memberAccess && typed.length < 1) return null;

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
          from,
          validFor: /^[\w$]*$/,
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
    const languages = new Set<string>();

    // Cerrar todos los documentos del proyecto
    for (const [filePath, sessionInfo] of this.sessions.entries()) {
      if (sessionInfo.session.projectId === projectId) {
        this.lspService.closeDocument(sessionInfo.session, filePath);
        languages.add(sessionInfo.session.language);
        this.sessions.delete(filePath);
      }
    }
    
    // Cerrar cada sesión por lenguaje (un contenedor por projectId+language)
    for (const language of languages) {
      await this.lspService.shutdownSession(projectId, language);
    }
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
    this.sessions.set(filePath, {
      session,
      version: 1,
      lastSentVersion: 1,
      lastSentAt: Date.now(),
      latestContent: content
    });
    this.lspService.openDocument(session, filePath, content, language);
  }
}

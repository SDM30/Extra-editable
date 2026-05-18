/**
 * codemirror-lsp-service.ts
 * 
 * Servicio adaptador que integra el protocolo LSP genérico con el editor CodeMirror.
 * 
 * Responsabilidades:
 * 1. Convertir mensajes LSP genéricos a extensiones de CodeMirror
 * 2. Gestionar sesiones: un archivo = una sesión con su propia versión y estado
 * 3. Proporcionar linting (mostrar diagnósticos como errores/warnings)
 * 4. Proporcionar autocompletado (Ctrl+Space o activación automática)
 * 5. Sincronizar cambios del editor con el servidor LSP
 * 6. Convertir posiciones LSP ↔ offsets de CodeMirror
 * 
 * @module services/codemirror-lsp-service
 * @dependencies LspService, @codemirror/view, @codemirror/lint, @codemirror/autocomplete
 */
// app/services/codemirror-lsp.service.ts
import { Injectable } from '@angular/core';
import { EditorView, hoverTooltip, tooltips } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import {
  CompletionContext,
  CompletionResult,
  autocompletion,
  startCompletion,
} from '@codemirror/autocomplete';
import { forceLinting, linter, Diagnostic } from '@codemirror/lint';
import { LspService, LSPSession } from './lsp-service';

/**
 * Tipo simplificado de LSPCompletionItem (puede venir del servidor LSP)
 * @interface LSPCompletionItem
 */

export interface LSPCompletionItem {
  label: string;
  kind?: number;
  detail?: unknown;
  insertText?: string;
  documentation?: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class CodeMirrorLspService {
  private sessions: Map<
    string,
    {
      session: LSPSession;
      version: number;
      lastSentVersion: number;
      lastSentAt: number;
      latestContent: string;
    }
  > = new Map();
  private diagnostics: Map<string, Diagnostic[]> = new Map();

  constructor(private lspService: LspService) {}

  /**
   * Sincroniza cambios pendientes con el servidor LSP
   * 
   * Si hay cambios en el documento que aún no fueron enviados al LSP,
   * los envía ahora via updateDocument(). Implementa throttling (25ms)
   * para evitar saturar el servidor con demasiadas solicitudes.
   * 
   * @private
   * @param {string} filePath - Ruta relativa del archivo
   * @returns {void}
   */
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
      sessionInfo.version,
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
          const isCpp =
            filePath.endsWith('.cpp') ||
            filePath.endsWith('.cc') ||
            filePath.endsWith('.cxx') ||
            filePath.endsWith('.hpp') ||
            filePath.endsWith('.h');

          if (isTsJs || isPython || isCpp) {
            // Para Python, ser más conservador para evitar ruido:
            // - siempre en '.' (member access)
            // - o cuando el identificador actual tiene longitud >= 2
            const lookback = update.state.doc.sliceString(Math.max(0, head - 50), head);
            const currentIdent = (lookback.match(/[\w$]+$/) || [''])[0];

            const lastTwo = head > 1 ? update.state.doc.sliceString(head - 2, head) : '';
            const shouldTrigger =
              prevChar === '.' ||
              (isTsJs && /[\w$.]/.test(prevChar)) ||
              (isPython && /[\w_]/.test(prevChar) && currentIdent.length >= 2) ||
              (isCpp &&
                (prevChar === '.' ||
                  prevChar === '>' || // para '->'
                  lastTwo === '::' || // scope
                  (/[A-Za-z_]/.test(prevChar) && currentIdent.length >= 2)));

            if (shouldTrigger) {
              clearTimeout(completionTimeout);
              completionTimeout = setTimeout(
                () => {
                  try {
                    // Asegurar que el LSP tenga el texto más reciente ANTES de pedir completion;
                    // si no, suele aparecer recién después (p.ej. al presionar backspace).
                    this.flushDocumentChanges(filePath);
                    startCompletion(update.view);
                  } catch {
                    // ignore
                  }
                },
                isPython ? 120 : isCpp ? 80 : 50,
              );
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
   * Inicializa el soporte LSP completo para un editor CodeMirror
   * 
   * Este es el método principal para conectar un editor con el servidor LSP.
   * Realiza lo siguiente:
   * 1. Inicializa sesión LSP via LspService
   * 2. Abre el documento en el servidor
   * 3. Configura extensión de linting para mostrar diagnósticos
   * 4. Configura listener para recibir diagnósticos del servidor
   * 5. Configura extensión de autocompletado
   * 6. Retorna todas las extensiones necesarias para agregarse al EditorView
   * 
   * @param {string} projectId - ID del proyecto
   * @param {string} language - Lenguaje de programación (python, cpp, typescript)
   * @param {EditorView} editorView - Instancia del editor CodeMirror
   * @param {string} [filePath='main'] - Nombre base del archivo (sin extensión)
   * @returns {Promise<Extension[]>} Array de extensiones de CodeMirror a agregar al editor
   * @throws {Error} Si falla la inicialización LSP o conexión WebSocket
   * 
   * @example
   * const extensions = await lspService.attachLSPToEditor(
   *   'my-project', 'python', editorView, 'myapp'
   * );
   * // extensions contiene linting + completion + updateListener
   */
  async attachLSPToEditor(
    projectId: string,
    language: string,
    editorView: EditorView,
    filePath: string = 'main',
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
      latestContent: content,
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

    // Tooltip al hover para mostrar diagnósticos (errores/warnings) del LSP
    const hoverDiagExt = this.createDiagnosticsHoverExtension(fullPath);

    console.log(`[CodeMirror-LSP] LSP adjuntado a ${fullPath}`);

    // Retornar las extensions que necesitan ser añadidas al EditorView
    return [updateListener, completionExt, lintExt, hoverDiagExt];
  }

  /**
   * Crea una extensión de tooltip al hover para mostrar diagnósticos.
   *
   * Útil cuando el usuario pasa el mouse por el texto subrayado y espera
   * ver el error/warning sin abrir paneles adicionales.
   */
  private createDiagnosticsHoverExtension(filePath: string): Extension {
    // Asegurar que los tooltips se rendericen en el body para evitar recortes
    // por contenedores con overflow/stacking contexts.
    const tooltipHost = tooltips({ parent: document.body });

    const hoverExt = hoverTooltip((view, pos) => {
      const diags = this.diagnostics.get(filePath) || [];
      if (diags.length === 0) return null;

      const matches = diags.filter((d) => {
        const from = d.from ?? 0;
        const to = d.to ?? from;
        // En CodeMirror los rangos suelen ser [from, to) (to exclusivo).
        // Para errores puntuales (from===to), aceptar también el carácter adyacente.
        if (from === to) return pos === from || pos === from + 1;
        return pos >= from && pos < to;
      });

      if (matches.length === 0) return null;

      const from = Math.min(...matches.map((d) => d.from ?? 0));
      const to = Math.max(...matches.map((d) => (d.to ?? d.from ?? 0)));
      const rawMessages = matches.map((d) => d.message).filter(Boolean);

      const normalizeForDedup = (msg: string): string => {
        // Normalizar whitespace y recortar comillas/puntuación finales para
        // cubrir casos tipo: "… 'std'" vs "… 'std"
        let s = msg.trim();
        s = s.replace(/\s+/g, ' ');
        s = s.replace(/[\s'"]+$/g, (m) => (m.includes("'") || m.includes('"') ? '' : m));
        // Recortar signos de puntuación repetidos al final
        s = s.replace(/[.,;:]+$/g, '');
        return s.trim();
      };

      const seen = new Set<string>();
      const uniqueMessages: string[] = [];
      for (const m of rawMessages) {
        const asString = String(m);
        const key = normalizeForDedup(asString);
        if (key.length === 0) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueMessages.push(asString.trim());
      }

      return {
        pos: from,
        end: Math.max(from, to),
        create: () => {
          const dom = document.createElement('div');
          dom.className = 'cm-lsp-hover-diagnostic';

          for (let i = 0; i < uniqueMessages.length; i++) {
            if (i > 0) dom.appendChild(document.createElement('br'));
            dom.appendChild(document.createTextNode(String(uniqueMessages[i])));
          }

          return { dom };
        },
      };
    });

    // `hoverTooltip` devuelve una extensión con propiedad `active` (tipado),
    // pero internamente incluye también la configuración necesaria para tooltips.
    // Devolvemos ambos para asegurar el host y el hover.
    return [tooltipHost, hoverExt];
  }

  /**
   * Configura un listener para recibir diagnósticos del servidor LSP
   * 
   * Se suscribe al observable diagnostics$ del LspService y convierte
   * los diagnósticos LSP al formato de CodeMirror, mostrándolos en el editor.
   * 
   * @private
   * @param {EditorView} editorView - Instancia del editor
   * @param {string} filePath - Ruta del archivo para coincidencia
   * @param {Extension} lintExt - Extension de linting (para forzar reevaluación)
   * @returns {void}
   */
  private setupDiagnosticListener(
    editorView: EditorView,
    filePath: string,
    lintExt: Extension,
  ): void {
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
          docLength: editorView.state.doc.length,
        });
      }

      const cmDiagnostics = diagnostics.map((d) => {
        const from = this.positionToOffsetClamped(editorView, d.range.start);
        const to = this.positionToOffsetClamped(editorView, d.range.end);
        return {
          from,
          to: Math.max(from, to),
          severity: this.mapSeverity(d.severity),
          message: d.message,
        } as Diagnostic;
      });

      this.diagnostics.set(filePath, cmDiagnostics);
      console.log(`[LSP] ${cmDiagnostics.length} diagnósticos actualizados para ${filePath}`);

      // Forzar reevaluación del linter para que tome los diagnósticos recién actualizados
      forceLinting(editorView);
    });
  }

  /**
   * Crea una extensión de linting para CodeMirror
   * 
   * La extensión evalúa el array de diagnósticos almacenado para este archivo
   * cada vez que CodeMirror solicita la validación.
   * 
   * @private
   * @param {string} filePath - Ruta del archivo
   * @returns {Extension} Extension de linting de CodeMirror
   */
  private createLintExtension(filePath: string): Extension {
    return linter((editorView) => {
      return this.diagnostics.get(filePath) || [];
    });
  }

  /**
   * Crea una extensión de autocompletado para CodeMirror
   * 
   * La extensión configura CodeMirror para mostrar sugerencias cuando:
   * - El usuario presiona Ctrl+Space
   * - El usuario escribe y se detecta contexto de autocompletado
   * - Pausa: 150ms después de escribir
   * 
   * @private
   * @param {string} filePath - Ruta del archivo
   * @returns {Extension} Extension de autocompletado de CodeMirror
   */
  private createCompletionExtension(filePath: string): Extension {
    return autocompletion({
      override: [this.createCompletionFunction(filePath)],
      activateOnTyping: true,
      interactionDelay: 150,
    });
  }

  /**
   * Función de autocompletado para CodeMirror
   * 
   * Solicita completions al servidor LSP cuando el usuario escribe o presiona Ctrl+Space.
   * Filtra requests para no bombardear el servidor:
   * - Solo si hay contexto (member access, identificador, etc.)
   * - Solo si el prefijo tiene longitud mínima
   * 
   * @private
   * @param {string} filePath - Ruta del archivo
   * @returns {Function} Función que maneja requests de autocompletado
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
          character,
        );

        if (items.length === 0) return null;

        return {
          from,
          validFor: /^[\w$]*$/,
          options: items
            .map((item: any) => {
              const label = typeof item?.label === 'string' ? item.label : String(item?.label ?? '');
              if (!label) return null;

              const detail = this.normalizeCompletionText(item?.detail);
              const info = this.normalizeCompletionInfo(item?.documentation);

              return {
                label,
                type: this.mapCompletionKind(item?.kind),
                ...(detail ? { detail } : {}),
                ...(info ? { info } : {}),
                // Mantener `apply` como string para evitar crashes en el picker.
                apply:
                  typeof item?.insertText === 'string' && item.insertText.length > 0
                    ? item.insertText
                    : label,
              };
            })
            .filter(Boolean) as any[],
        };
      } catch (e) {
        console.error('[LSP] Error en autocompletado:', e);
        return null;
      }
    };
  }

  /**
   * Normaliza texto opcional de completions (detail, etc.) a string.
   * Evita pasar objetos al UI de CodeMirror.
   */
  private normalizeCompletionText(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value && typeof value === 'object' && 'value' in value && typeof (value as any).value === 'string') {
      return (value as any).value;
    }
    return undefined;
  }

  /**
   * Normaliza `documentation` LSP para usarlo en `Completion.info`.
   *
   * CodeMirror espera `info` como string o función. Si se pasa un objeto, puede
   * crashear con "info is not a function" en el picker.
   */
  private normalizeCompletionInfo(value: unknown): string | undefined {
    if (typeof value === 'string') return value;

    // MarkupContent típico de LSP: { kind: 'markdown' | 'plaintext', value: string }
    if (value && typeof value === 'object' && 'value' in value && typeof (value as any).value === 'string') {
      return (value as any).value;
    }

    if (Array.isArray(value)) {
      const parts = value
        .map((v) => {
          if (typeof v === 'string') return v;
          if (v && typeof v === 'object' && 'value' in v && typeof (v as any).value === 'string') {
            return (v as any).value;
          }
          return '';
        })
        .filter((s) => s.trim().length > 0);

      return parts.length ? parts.join('\n\n') : undefined;
    }

    return undefined;
  }

  /**
   * Desconecta LSP de un editor específico
   * 
   * Cierra el documento en el servidor LSP y limpia referencias locales.
   * Puede llamarse cuando se cambia de archivo o se cierra el editor.
   * 
   * @param {string} filePath - Ruta relativa del archivo
   * @returns {void}
   */
  detachLSP(filePath: string): void {
    const sessionInfo = this.sessions.get(filePath);
    if (sessionInfo) {
      this.lspService.closeDocument(sessionInfo.session, filePath);
      this.sessions.delete(filePath);
    }
  }

  /**
   * Cierra todas las sesiones de un proyecto
   * 
   * Limpia todos los documentos abiertos del proyecto en el servidor LSP
   * y cierra las sesiones por lenguaje. Se llama normalmente al destruir
   * el componente editor.
   * 
   * @param {string} projectId - ID del proyecto a cerrar
   * @returns {Promise<void>}
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
      python: '.py',
      cpp: '.cpp',
      typescript: '.ts',
      javascript: '.ts',
    };
    return extensions[language] || '.txt';
  }

  private positionToOffset(
    editorView: EditorView,
    pos: { line: number; character: number },
  ): number {
    const line = editorView.state.doc.line(pos.line + 1);
    return line.from + pos.character;
  }

  private positionToOffsetClamped(
    editorView: EditorView,
    pos: { line: number; character: number },
  ): number {
    const doc = editorView.state.doc;
    const lineNumber = Math.min(Math.max(1, (pos?.line ?? 0) + 1), doc.lines);
    const line = doc.line(lineNumber);
    const character = Math.min(Math.max(0, pos?.character ?? 0), line.length);
    return line.from + character;
  }

  private mapSeverity(severity: number): 'error' | 'warning' | 'info' {
    switch (severity) {
      case 1:
        return 'error';
      case 2:
        return 'warning';
      default:
        return 'info';
    }
  }

  private mapCompletionKind(kind: number): string {
    const kinds: Record<number, string> = {
      1: 'text',
      2: 'method',
      3: 'function',
      4: 'constructor',
      5: 'field',
      6: 'variable',
      7: 'class',
      8: 'interface',
      9: 'module',
      10: 'property',
      11: 'unit',
      12: 'value',
      13: 'enum',
      14: 'keyword',
      15: 'snippet',
      16: 'color',
      17: 'file',
      18: 'reference',
      19: 'folder',
      20: 'enumMember',
      21: 'constant',
      22: 'struct',
      23: 'event',
      24: 'operator',
      25: 'typeParameter',
    };
    return kinds[kind] || 'text';
  }

  async initializeSessionOnly(
    projectId: string,
    language: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const session = await this.lspService.initializeSession(projectId, language);
    this.sessions.set(filePath, {
      session,
      version: 1,
      lastSentVersion: 1,
      lastSentAt: Date.now(),
      latestContent: content,
    });
    this.lspService.openDocument(session, filePath, content, language);
  }
}

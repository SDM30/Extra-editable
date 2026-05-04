/**
 * lsp-types.ts
 *
 * Define las interfaces TypeScript que representan los tipos de datos del protocolo LSP
 * (Language Server Protocol). Estas interfaces se utilizan para comunicar información
 * entre el frontend (CodeMirror) y el servidor de lenguaje (pylsp, clangd, etc.).
 *
 * @module services/lsp-types
 */

/**
 * Representa un problema de diagnóstico en el código (error, warning, info)
 *
 * Los diagnósticos se envían desde el servidor LSP cuando detecta problemas
 * en el código abierto en el editor.
 *
 * @interface LSPDiagnostic
 * @property {LSPRange} range - Ubicación del problema en el archivo (inicio y fin)
 * @property {number} [severity] - Nivel de severidad (1=error, 2=warning, 3=info, 4=hint)
 * @property {string} [code] - Identificador del problema (ej: "F821" para undefined name)
 * @property {string} [source] - Identificador de la herramienta que generó el diagnóstico
 * @property {string} message - Descripción del problema a mostrar al usuario
 *
 * @example
 * {
 *   range: { start: { line: 5, character: 10 }, end: { line: 5, character: 20 } },
 *   severity: 1,
 *   code: "E302",
 *   message: "Expected 2 blank lines, found 1"
 * }
 */
export interface LSPDiagnostic {
  range: LSPRange;
  severity?: number;
  code?: string;
  source?: string;
  message: string;
}

/**
 * Define un rango de texto en un archivo mediante posiciones de inicio y fin
 *
 * Se utiliza para especificar la ubicación exacta de un problema, selección,
 * o región de código en el editor.
 *
 * @interface LSPRange
 * @property {LSPPosition} start - Posición inicial del rango (línea y carácter)
 * @property {LSPPosition} end - Posición final del rango (línea y carácter)
 *
 * @example
 * {
 *   start: { line: 0, character: 5 },
 *   end: { line: 0, character: 15 }
 * }
 */
export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

/**
 * Define una posición exacta en el código mediante línea y carácter
 *
 * Las líneas y caracteres son 0-indexados. Por ejemplo, el primer carácter
 * de la primera línea es { line: 0, character: 0 }.
 *
 * @interface LSPPosition
 * @property {number} line - Número de línea (0-indexado)
 * @property {number} character - Posición del carácter en la línea (0-indexado)
 *
 * @example
 * { line: 5, character: 10 }  // Segunda línea (índice 5), carácter 11
 */
export interface LSPPosition {
  line: number;
  character: number;
}

/**
 * Representa un item de autocompletado sugerido por el servidor de lenguaje
 *
 * El servidor LSP devuelve una lista de estos items cuando el usuario solicita
 * autocompletado (Ctrl+Space) o escribe código.
 *
 * @interface LSPCompletionItem
 * @property {string} label - Texto que se muestra en la lista de autocompletado
 * @property {number} [kind] - Tipo de item (1=text, 2=method, 3=function, 7=class, etc.)
 * @property {string} [detail] - Información adicional sobre el item (ej: firma de función)
 * @property {string} [documentation] - Descripción o documentación del item
 * @property {string} [insertText] - Texto a insertar si es diferente al label
 * @property {number} [insertTextFormat] - Formato del texto (1=plaintext, 2=snippet)
 * @property {string} [sortText] - Texto para ordenar items en la lista
 *
 * @example
 * {
 *   label: "forEach",
 *   kind: 2,
 *   detail: "(method) Array<T>.forEach(callback: Function): void",
 *   documentation: "Calls a function for each element in the array",
 *   insertText: "forEach"
 * }
 */
export interface LSPCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
}

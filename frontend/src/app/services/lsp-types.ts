// lsp-types.ts
export interface LSPDiagnostic {
  range: LSPRange;
  severity?: number;
  code?: string;
  source?: string;
  message: string;
}

export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

export interface LSPPosition {
  line: number;
  character: number;
}

export interface LSPCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
}
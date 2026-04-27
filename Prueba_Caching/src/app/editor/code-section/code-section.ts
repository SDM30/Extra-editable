import { Component, Input, Output, EventEmitter } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CodeEditor } from '@acrodata/code-editor';

import { Extension } from '@codemirror/state';

import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';

export type Theme = 'light' | 'dark' | Extension;

@Component({
  selector: 'app-code-section',
  standalone: true,
  imports: [FormsModule, CodeEditor],
  templateUrl: './code-section.html',
  styleUrl: './code-section.css',
})
export class CodeSection {
  private _value = '';
  @Input() set value(val: string) {
    this._value = val;
  }
  get value(): string {
    return this._value;
  }
  @Output() valueChange = new EventEmitter<string>();
  @Input() theme: Theme = 'light';

  @Input() language: string = 'cpp';
  @Input() resultado?: string;
  @Input() resultadoOk?: boolean;
  @Input() cargando: boolean = false;

  // panel del problema
  isProblemCollapsed = false;

  onValueChange(newValue: string) {
    this.valueChange.emit(newValue);
  }

  toggleProblem(): void {
    this.isProblemCollapsed = !this.isProblemCollapsed;
  }

  // Language -> CodeMirror extension
  private languageExtension(): Extension {
    switch (this.language) {
      case 'cpp':
        return cpp();
      case 'javascript':
        return javascript();
      case 'python':
        return python();
      default:
        return cpp();
    }
  }

  // Extensions finales del editor
  get editorExtensions(): Extension[] {
    return [this.languageExtension()];
  }
}

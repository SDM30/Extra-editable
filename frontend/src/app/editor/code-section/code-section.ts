import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CodeEditor } from '@acrodata/code-editor';

import { Extension } from '@codemirror/state';

import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { execution } from '../../services/execution';

export type Theme = 'light' | 'dark' | Extension;

@Component({
  selector: 'app-code-section',
  standalone: true,
  imports: [FormsModule, CodeEditor],
  templateUrl: './code-section.html',
  styleUrl: './code-section.css',
})
export class CodeSection {
  @Input() value = '';
  @Input() theme: Theme = 'light';

  @Input() language: string = 'cpp';

  // panel del problema
  isProblemCollapsed = false;

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

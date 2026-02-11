import { Component, Input, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CodeEditor } from '@acrodata/code-editor';
import { Extension } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';

// Imports de los temas que mencionaste
import { oneDark } from '@codemirror/theme-one-dark';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { solarizedLight, solarizedDark } from '@uiw/codemirror-theme-solarized';
import { nord } from '@uiw/codemirror-theme-nord';
import { kimbie } from '@uiw/codemirror-theme-kimbie';
import { languages as cmLanguages } from '@codemirror/language-data';
import type { LanguageDescription } from '@codemirror/language';
import { CodigoFuenteServ } from '../services/codigo-fuente-serv';

export type Theme = 'light' | 'dark' | Extension;

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [FormsModule, CodeEditor],
  templateUrl: './editor.html',
  styleUrl: './editor.css',
})
export class Editor {
  private codigoService = inject(CodigoFuenteServ);
  value = `#include <iostream>\n\nint main() {\n    std::cout << "Hola C++" << std::endl;\n    return 0;\n}`;
  resultado?: string;

  /** Opcion por defecto */
  @Input() theme: Theme = 'light';

  /** Opciones para los temas del editor */
  themeOptions = [
    { label: 'Standard Light', value: 'light' },
    { label: 'Standard Dark', value: 'dark' },
    { label: 'One Dark', value: oneDark },
    { label: 'Dracula', value: dracula },
    { label: 'Solarized Light', value: solarizedLight },
    { label: 'Solarized Dark', value: solarizedDark },
    { label: 'Nord', value: nord },
    { label: 'Kimbie', value: kimbie },
  ];

  languages: LanguageDescription[] = cmLanguages;
  language = 'cpp';

  ejecutar() {
    this.codigoService.ejecutarCodigo({ contenido: this.value }).subscribe({
      next: (resp) => (this.resultado = resp.resultado ?? 'Respuesta recibida'),
      error: (err) => (this.resultado = 'Error: ' + (err.message ?? err.status)),
    });
  }
}

import { ChangeDetectorRef, Component } from '@angular/core';
import { finalize, timeout } from 'rxjs';
import { Extension } from '@codemirror/state';

import { Header } from './headerIDE/headerIDE';
import { CodeSection } from './code-section/code-section';

import { oneDark } from '@codemirror/theme-one-dark';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { solarizedLight, solarizedDark } from '@uiw/codemirror-theme-solarized';
import { nord } from '@uiw/codemirror-theme-nord';
import { kimbie } from '@uiw/codemirror-theme-kimbie';
import { ExecutionService } from '../services/execution-service';

export type Theme = 'light' | 'dark' | Extension;

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [Header, CodeSection],
  templateUrl: './editor.html',
  styleUrls: ['./editor.css'],
})
export class Editor {
  value = `#include <iostream>\n\nint main() {\n    std::cout << "Hola C++" << std::endl;\n    return 0;\n}`;

  theme: Theme = 'dark';
  language: string = 'cpp';

  themeOptions = [
    { label: 'Standard Light', value: 'light' as Theme },
    { label: 'Standard Dark', value: 'dark' as Theme },
    { label: 'One Dark', value: oneDark as Theme },
    { label: 'Dracula', value: dracula as Theme },
    { label: 'Solarized Light', value: solarizedLight as Theme },
    { label: 'Solarized Dark', value: solarizedDark as Theme },
    { label: 'Nord', value: nord as Theme },
    { label: 'Kimbie', value: kimbie as Theme },
  ];

  languageOptions = [
    { label: 'C++', value: 'cpp' },
    { label: 'JavaScript', value: 'javascript' },
    { label: 'Python', value: 'python' },
  ];

  resultado?: string;
  resultadoOk?: boolean;
  cargando = false;

  constructor(
    private executionService: ExecutionService,
    private cdr: ChangeDetectorRef,
  ) {}

  onRunCode() {
    // Estado inicial de cada ejecución
    this.resultado = undefined;
    this.resultadoOk = undefined;
    this.cargando = true;
    this.executionService
      .runCode(this.value)
      .pipe(
        // Evita que la UI quede esperando para siempre si la request no responde
        timeout(10000),
        finalize(() => {
          // Siempre apagar loading (éxito, error o timeout)
          this.cargando = false;
          //ChangeDetectorRef (cdr)
          // Forzar detección de cambios
          this.cdr.detectChanges();
        }),
      )
      .subscribe({
        next: (resp) => {
          const resultadoLimpio = this.limpiarResultado(resp.resultado ?? 'Respuesta recibida');
          this.resultadoOk = this.extraerEstadoOk(resultadoLimpio);
          this.resultado = this.formatearSalida(resultadoLimpio, resp.tiempo);

          this.cdr.detectChanges();
        },
        error: (err) => {
          this.resultadoOk = false;
          if (err?.name === 'TimeoutError') {
            this.resultado = 'Error: timeout esperando respuesta del backend';
          } else {
            this.resultado = 'Error: ' + (err?.message ?? err?.status ?? err);
          }
          this.cdr.detectChanges();
        },
      });
  }

  private limpiarResultado(resultado: string): string {
    return resultado.replace(/^id\s*=\s*[^|]*\|\s*/i, '');
  }

  private extraerEstadoOk(resultado: string): boolean | undefined {
    const match = resultado.match(/(^|\n)\s*ok\s*=\s*(true|false)\s*(\n|$)/i);
    if (!match) {
      return undefined;
    }
    return match[2].toLowerCase() === 'true';
  }

  private formatearSalida(resultado: string, tiempo?: string): string {
    return `${resultado}\ntiempo=${tiempo ?? 'N/A'}`;
  }
}

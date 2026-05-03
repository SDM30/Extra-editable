import { ChangeDetectorRef, Component } from '@angular/core';
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
  value = '';
  theme: Theme = 'dark';
  language: string = 'cpp';

  resultado = '';
  resultadoOk = false;
  cargando = false;

  terminalHeight = 220;

  private isResizing = false;
  private startY = 0;
  private startHeight = 220;

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
    { label: 'Python', value: 'python' },
    { label: 'TypeScript', value: 'typescript' },
  ];

  constructor(
    private executionService: ExecutionService,
    private cdr: ChangeDetectorRef
  ) { }

  ejecutarCodigo(): void {
    this.resultado = '';
    this.cargando = true;
    this.resultadoOk = false;

    this.executionService.connect(
      (message) => {
        if (message.type === 'connected') {
          this.executionService.runCode(this.language, this.value);
        }

        if (message.type === 'queued') {
          this.resultado += `En cola. Posición: ${message.position}\n`;
        }

        if (message.type === 'dequeued') {
          this.resultado += `${message.data}\n`;
        }

        if (message.type === 'started') {
          this.resultado += 'Ejecución iniciada...\n';
        }

        if (message.type === 'output') {
          this.resultado += message.data;
        }

        if (message.type === 'error') {
          this.resultado += '\nError: ' + message.data;
          this.cargando = false;
          this.resultadoOk = false;
        }

        if (message.type === 'timeout') {
          this.resultado += '\n' + message.data;
          this.cargando = false;
          this.resultadoOk = false;
        }

        if (message.type === 'finished') {
          this.cargando = false;
          this.resultadoOk = message.exitCode === 0;
          this.resultado += `\nProceso finalizado con código ${message.exitCode}`;
          this.executionService.disconnect();
        }

        this.cdr.detectChanges();
      },
      () => {
        this.resultado = 'No se pudo conectar con el servicio de ejecución.';
        this.cargando = false;
        this.cdr.detectChanges();
      },
      () => {
        this.cargando = false;
        this.cdr.detectChanges();
      }
    );
  }

  enviarEntrada(input: string): void {
    if (!input.trim()) return;

    /* Mostrar también en terminal */
    this.resultado += input + '\n';

    /* Enviar al contenedor */
    this.executionService.sendInput(input);

    this.cdr.detectChanges();
  }

  startResize(event: MouseEvent): void {
    this.isResizing = true;
    this.startY = event.clientY;
    this.startHeight = this.terminalHeight;

    document.addEventListener('mousemove', this.onResize);
    document.addEventListener('mouseup', this.stopResize);
  }

  onResize = (event: MouseEvent): void => {
    if (!this.isResizing) return;

    const delta = this.startY - event.clientY;
    const newHeight = this.startHeight + delta;

    if (newHeight >= 120 && newHeight <= 600) {
      this.terminalHeight = newHeight;
      this.cdr.detectChanges();
    }
  };

  stopResize = (): void => {
    this.isResizing = false;

    document.removeEventListener('mousemove', this.onResize);
    document.removeEventListener('mouseup', this.stopResize);
  };
}
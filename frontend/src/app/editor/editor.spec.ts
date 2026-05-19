import { Component } from '@angular/core';
import { Header } from '../editor/headerIDE/headerIDE';
import { CodeSection, Theme } from '../editor/code-section/code-section';
import { ExecutionService } from '../services/execution-service';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [Header, CodeSection],
  templateUrl: './home-page.html',
  styleUrl: './home-page.css'
})
export class HomePage {
  code = `#include <iostream>

int main() {
    std::cout << "Hola C++" << std::endl;
    return 0;
}`;

  language = 'cpp';
  theme: Theme = 'dark';

  cargando = false;
  resultado = '';
  resultadoOk = false;

  languageOptions = [
    { label: 'C++', value: 'cpp' },
    { label: 'TypeScript', value: 'typescript' },
    { label: 'Python', value: 'python' },
  ];

  themeOptions = [
    { label: 'Light', value: 'light' as Theme },
    { label: 'Dark', value: 'dark' as Theme },
  ];

  constructor(private executionService: ExecutionService) { }

  ejecutarCodigo(): void {
    this.cargando = true;
    this.resultado = 'Ejecutando...';
    this.resultadoOk = false;

    this.executionService.execute({
      language: this.language,
      code: this.code,
      stdin: ''
    }).subscribe({
      next: (res) => {
        this.cargando = false;
        this.resultadoOk = res.exitCode === 0;
        this.resultado = res.stdout || res.stderr || 'Sin salida';
      },
      error: (err) => {
        this.cargando = false;
        this.resultadoOk = false;
        this.resultado = err.error?.message || 'Error conectando con el servicio de ejecución';
      }
    });
  }
}
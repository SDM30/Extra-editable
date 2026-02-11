import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ExecutionService {
  constructor() { }

  runCode(code: string) {
    console.log('Ejecutando código:');
    console.log(code);
  }
}

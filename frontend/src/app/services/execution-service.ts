import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CodigoFuente } from '../model/codigo-fuente';

// Interfaces para type-safety
export interface ExecutionRequest {
  contenido: string;
  lenguaje: string;
}

export interface ExecutionResponse {
  status: string;
  output?: string;
  errorMessage?: string;
  executionTime?: number;
}

@Injectable({
  providedIn: 'root',
})
export class execution {
  private apiUrl = 'http://localhost:8080/api';

  constructor(private http: HttpClient) {}

  runCode(code: string, language: string = 'cpp'): Observable<CodigoFuente> {
    const request: CodigoFuente = {
      id: 0,
      contenido: code,
      fecha: new Date().toISOString(),
      resultado: '',
      tiempo: '',
    };

    return this.http.post<CodigoFuente>(
      `${this.apiUrl}/ejecutar`,
      request
    );
  }
}
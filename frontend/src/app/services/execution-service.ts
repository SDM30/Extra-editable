import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CodigoFuente} from '../model/codigo-fuente';
import { enviroment } from '../environments/enviroment';
@Injectable({
  providedIn: 'root',
})
export class ExecutionService {
  private apiUrl = enviroment.apiBaseUrl;

  constructor(private http: HttpClient) {}
  runCode(code: string, language: string = 'cpp'): Observable<CodigoFuente> {
    const request: CodigoFuente = {
      id: 0,
      fecha: new Date().toISOString(),
      resultado: '',
      tiempo: '',
      contenido: code,
    };

    return this.http.post<CodigoFuente>(
      `${this.apiUrl}/ejecutar`,
      request
    );
  }
}
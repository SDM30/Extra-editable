import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { enviroment } from '../environments/enviroment';
import { CodigoFuente } from '../model/codigo-fuente';

@Injectable({
  providedIn: 'root',
})
export class ExecutionService {
  private http = inject(HttpClient);
  private base = enviroment.apiBaseUrl;
  constructor() {}

  runCode(code: string) {
    const payload: Partial<CodigoFuente> = { contenido: code };
    return this.http.post<CodigoFuente>(`${this.base}/ejecutar`, payload);
  }
}

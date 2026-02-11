import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { enviroment } from '../environments/enviroment';
import { CodigoFuente } from '../model/codigo-fuente';

@Injectable({
  providedIn: 'root',
})
export class CodigoFuenteServ {
  private http = inject(HttpClient);
  private base = enviroment.apiBaseUrl;

  // Enviar el código fuente c++ a ser compilado
  ejecutarCodigo(body: Partial<CodigoFuente>) {
    return this.http.post<CodigoFuente>(`${this.base}/ejecutar`, body);
  }
}

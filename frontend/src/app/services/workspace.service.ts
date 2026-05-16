import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { enviroment } from '../environments/enviroment';
import { AuthService } from './auth.service';

export interface WorkspaceArchivo {
  id: number;
  nombre: string;
  contenido: string;
  fechaCreacion?: string;
  fechaActualizacion?: string;
}

export interface WorkspaceProyecto {
  id: number;
  nombre: string;
  descripcion: string;
  lenguaje: 'CPP' | 'PYTHON' | 'TYPESCRIPT';
  fechaCreacion?: string;
  archivos?: WorkspaceArchivo[];
}

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private readonly baseUrl = enviroment.apiBaseUrl;

  constructor(private http: HttpClient, private auth: AuthService) {}

  private authOptions() {
    const token = this.auth.getToken();
    if (!token) {
      throw new Error('No hay sesión autenticada para consultar proyectos');
    }

    return {
      headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
    };
  }

  async listProjects(): Promise<WorkspaceProyecto[]> {
    const response = await firstValueFrom(
      this.http.get<WorkspaceProyecto[]>(`${this.baseUrl}/projects/`, this.authOptions()),
    );
    return response;
  }

  async getProject(projectId: number): Promise<WorkspaceProyecto> {
    return firstValueFrom(
      this.http.get<WorkspaceProyecto>(`${this.baseUrl}/projects/${projectId}/`, this.authOptions()),
    );
  }

  async createProject(payload: {
    nombre: string;
    descripcion: string;
    lenguaje: WorkspaceProyecto['lenguaje'];
  }): Promise<WorkspaceProyecto> {
    return firstValueFrom(
      this.http.post<WorkspaceProyecto>(`${this.baseUrl}/projects/`, payload, this.authOptions()),
    );
  }

  async createArchivo(
    projectId: number,
    payload: { nombre: string; contenido: string },
  ): Promise<WorkspaceArchivo> {
    return firstValueFrom(
      this.http.post<WorkspaceArchivo>(
        `${this.baseUrl}/projects/${projectId}/archivos/`,
        payload,
        this.authOptions(),
      ),
    );
  }

  async updateArchivo(
    projectId: number,
    archivoId: number,
    payload: { nombre?: string; contenido?: string },
  ): Promise<WorkspaceArchivo> {
    return firstValueFrom(
      this.http.patch<WorkspaceArchivo>(
        `${this.baseUrl}/projects/${projectId}/archivos/${archivoId}/`,
        payload,
        this.authOptions(),
      ),
    );
  }
}
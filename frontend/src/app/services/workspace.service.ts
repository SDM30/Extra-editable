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

interface PaginatedProjectsResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: WorkspaceProyecto[];
}

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private readonly baseUrl = enviroment.apiBaseUrl;

  constructor(private http: HttpClient, private auth: AuthService) {}

  private authOptions() {
    const token = this.auth.getToken();
    return {
      headers: new HttpHeaders({
        ...(token && { Authorization: `Bearer ${token}` }),
      }),
    };
  }

  async listProjects(): Promise<WorkspaceProyecto[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<WorkspaceProyecto[] | PaginatedProjectsResponse>(`${this.baseUrl}/projects/`, this.authOptions()),
      );

      if (Array.isArray(response)) {
        return response;
      }

      return response?.results ?? [];
    } catch (error) {
      console.error('[WorkspaceService] Error fetching projects:', error);
      return [];
    }
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
    try {
      return await firstValueFrom(
        this.http.post<WorkspaceProyecto>(`${this.baseUrl}/projects/`, payload, this.authOptions()),
      );
    } catch (error) {
      console.error('[WorkspaceService] Error creating project:', error);
      throw error;
    }
  }

  async createArchivo(
    projectId: number,
    payload: { nombre: string; contenido: string },
  ): Promise<WorkspaceArchivo> {
    try {
      return await firstValueFrom(
        this.http.post<WorkspaceArchivo>(
          `${this.baseUrl}/projects/${projectId}/archivos/`,
          payload,
          this.authOptions(),
        ),
      );
    } catch (error) {
      console.error('[WorkspaceService] Error creating archivo:', error);
      throw error;
    }
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
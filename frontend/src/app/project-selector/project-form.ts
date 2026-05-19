import { ChangeDetectorRef, Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { WorkspaceService } from '../services/workspace.service';
import { AuthService } from '../services/auth.service';

interface UserSuggestion {
  id: number;
  username: string;
}

@Component({
  selector: 'app-project-form',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './project-form.html',
  styleUrls: ['./project-form.css'],
})
export class ProjectForm {
  @Output() created = new EventEmitter<number>();
  @Output() cancelled = new EventEmitter<void>();

  nombre = '';
  descripcion = '';
  lenguaje: 'CPP' | 'PYTHON' | 'TYPESCRIPT' = 'CPP';
  colaboradores: UserSuggestion[] = [];
  searchQuery = '';
  suggestions: UserSuggestion[] = [];
  searching = false;
  creating = false;
  error = '';

  constructor(
    private workspace: WorkspaceService,
    private auth: AuthService,
    private cdr: ChangeDetectorRef,
  ) {}

  /** Agrega un usuario a la lista de colaboradores (máx 4, sin duplicados). */
  addColaborador(user: UserSuggestion) {
    if (this.colaboradores.length >= 4) return;
    if (this.colaboradores.find((c) => c.id === user.id)) return;
    this.colaboradores = [...this.colaboradores, user];
    this.searchQuery = '';
    this.suggestions = [];
  }

  removeColaborador(userId: number) {
    this.colaboradores = this.colaboradores.filter((c) => c.id !== userId);
  }

  /** Búsqueda asíncrona de usuarios (debounced vía ngModelChange). */
  async onSearchInput() {
    if (this.searchQuery.length < 2) {
      this.suggestions = [];
      return;
    }
    this.searching = true;
    try {
      this.suggestions = await this.workspace.searchUsers(this.searchQuery);
    } finally {
      this.searching = false;
      this.cdr.detectChanges();
    }
  }

  /** Crea el proyecto vía POST y emite el ID al padre. */
  async create() {
    if (!this.nombre.trim()) {
      this.error = 'El nombre es obligatorio.';
      return;
    }
    this.creating = true;
    this.error = '';
    try {
      const created = await this.workspace.createProject({
        nombre: this.nombre.trim(),
        descripcion: this.descripcion.trim(),
        lenguaje: this.lenguaje,
        colaboradores: this.colaboradores.map((c) => c.id),
      });
      this.created.emit(created.id);
    } catch (e: any) {
      this.error = e?.error?.detail || e?.message || 'Error al crear el proyecto.';
    } finally {
      this.creating = false;
      this.cdr.detectChanges();
    }
  }

  cancel() {
    this.cancelled.emit();
  }
}

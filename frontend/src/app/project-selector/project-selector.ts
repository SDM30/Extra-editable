import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../services/auth.service';
import { WorkspaceService } from '../services/workspace.service';
import { ProjectForm } from './project-form';

interface ProjectCard {
  id: number;
  nombre: string;
  descripcion: string;
  lenguaje: string;
  fechaCreacion?: string;
  num_archivos: number;
  num_colaboradores: number;
  colaboradores: Array<{ id: number; username: string }>;
  usuario: string;
}

interface CollaboratorInfo {
  id: number;
  username: string;
  activo: boolean;
}

@Component({
  selector: 'app-project-selector',
  standalone: true,
  imports: [RouterModule, CommonModule, ProjectForm],
  templateUrl: './project-selector.html',
  styleUrls: ['./project-selector.css'],
})
export class ProjectSelector implements OnInit {
  projects: ProjectCard[] = [];
  loading = true;
  error = '';
  selectedProject: ProjectCard | null = null;
  detailCollaborators: CollaboratorInfo[] = [];
  loadingCollaborators = false;
  showForm = false;

  constructor(
    private auth: AuthService,
    private workspace: WorkspaceService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit() {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/auth']);
      return;
    }
    try {
      this.projects = await this.workspace.listProjects();
    } catch (e) {
      this.error = 'No se pudieron cargar los proyectos.';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  /** Abre el overlay de detalle con la lista de colaboradores del proyecto. */
  async openDetail(project: ProjectCard, event: Event) {
    event.stopPropagation();
    if (this.selectedProject?.id === project.id) {
      this.closeDetail();
      return;
    }
    this.selectedProject = project;
    this.loadingCollaborators = true;
    try {
      const resp = await this.workspace.getCollaborators(project.id);
      this.detailCollaborators = resp.usuarios;
    } catch {
      this.detailCollaborators = [];
    } finally {
      this.loadingCollaborators = false;
      this.cdr.detectChanges();
    }
  }

  closeDetail() {
    this.selectedProject = null;
    this.detailCollaborators = [];
  }

  openProject(projectId: number) {
    this.router.navigate(['/editor', projectId]);
  }

  onProjectCreated(projectId: number) {
    this.showForm = false;
    this.router.navigate(['/editor', projectId]);
  }

  onFormCancelled() {
    this.showForm = false;
  }

  /** Elimina un proyecto con confirmación. Remueve del estado local y cierra detalle si aplica. */
  async deleteProject(project: ProjectCard, event: Event) {
    event.stopPropagation();
    if (!confirm(`¿Eliminar el proyecto "${project.nombre}" y todos sus archivos? Esta acción no se puede deshacer.`)) return;

    try {
      await this.workspace.deleteProject(project.id);
      this.projects = this.projects.filter((p) => p.id !== project.id);
      if (this.selectedProject?.id === project.id) {
        this.closeDetail();
      }
      this.cdr.detectChanges();
    } catch (e: any) {
      alert('No se pudo eliminar el proyecto: ' + (e?.error?.detail || e?.message || 'Error desconocido'));
    }
  }

  logout() {
    this.auth.logout();
  }
}

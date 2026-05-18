import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { finalize, timeout } from 'rxjs';
import { Extension } from '@codemirror/state';
import { FormsModule } from '@angular/forms';

import { Header } from './headerIDE/headerIDE';
import { CodeSection } from './code-section/code-section';

import { oneDark } from '@codemirror/theme-one-dark';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { solarizedLight, solarizedDark } from '@uiw/codemirror-theme-solarized';
import { nord } from '@uiw/codemirror-theme-nord';
import { kimbie } from '@uiw/codemirror-theme-kimbie';
import { ExecutionService } from '../services/execution-service';
import { CollabService } from '../services/collab.service';
import { AuthService } from '../services/auth.service';
import { WorkspaceArchivo, WorkspaceProyecto, WorkspaceService } from '../services/workspace.service';

export type Theme = 'light' | 'dark' | Extension;

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [Header, CodeSection, FormsModule],
  templateUrl: './editor.html',
  styleUrls: ['./editor.css'],
})
export class Editor implements OnInit, OnDestroy {
  value = `#include <iostream>\n\nint main() {\n    std::cout << "Hola C++" << std::endl;\n    return 0;\n}`;

  theme: Theme = 'dark';
  language: string = 'cpp';

  themeOptions = [
    { label: 'Standard Light', value: 'light' as Theme },
    { label: 'Standard Dark', value: 'dark' as Theme },
    { label: 'One Dark', value: oneDark as Theme },
    { label: 'Dracula', value: dracula as Theme },
    { label: 'Solarized Light', value: solarizedLight as Theme },
    { label: 'Solarized Dark', value: solarizedDark as Theme },
    { label: 'Nord', value: nord as Theme },
    { label: 'Kimbie', value: kimbie as Theme },
  ];

  languageOptions = [
    { label: 'C++', value: 'cpp' },
    { label: 'TypeScript', value: 'typescript' },
    { label: 'Python', value: 'python' },
  ];

  resultado?: string;
  resultadoOk?: boolean;
  cargando = false;
  projectId: string = '';
  projects: WorkspaceProyecto[] = [];
  selectedProjectId: number | null = null;
  selectedArchivoId: number | null = null;
  selectedRoom = '';
  currentFilePathBase = 'main';
  lspEnabled: boolean = false;
  languageDisabled = false;
  fallbackMode = false;
  renamingArchivoId: number | null = null;
  renamingName = '';
  terminalHeight: number = 220;
  collaborators: Array<{ userId: string; username: string; color: string }> = [];
  private collaboratorsSub?: Subscription;
  private selectionRequestId = 0;
  private roomContentCache = new Map<string, string>();

  constructor(
    private executionService: ExecutionService,
    private cdr: ChangeDetectorRef,
    private collab: CollabService,
    private auth: AuthService,
    private workspace: WorkspaceService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  async ngOnInit() {
    console.log('[Editor] ngOnInit starting');
    console.log('[Editor] isLoggedIn:', this.auth.isLoggedIn());
    if (!this.auth.isLoggedIn()) {
      console.log('[Editor] Not logged in, redirecting to /auth');
      await this.router.navigate(['/auth']);
      return;
    }

    const projectIdParam = this.route.snapshot.paramMap.get('projectId');
    if (!projectIdParam) {
      console.log('[Editor] No projectId in route, redirecting to /projects');
      await this.router.navigate(['/projects']);
      return;
    }

    const targetProjectId = Number(projectIdParam);
    if (isNaN(targetProjectId) || targetProjectId <= 0) {
      console.log('[Editor] Invalid projectId, redirecting to /projects');
      await this.router.navigate(['/projects']);
      return;
    }

    console.log('[Editor] Loading project:', targetProjectId);
    try {
      const project = await this.workspace.getProject(targetProjectId);
      this.projects = [project];
      console.log('[Editor] Project loaded:', project.nombre);
      await this.selectProject(project.id);
    } catch (error) {
      console.error('[Editor] Failed to load project:', error);
      this.useLocalFallbackProject();
    }

    this.collaboratorsSub?.unsubscribe();
    this.collaboratorsSub = this.collab.collaborators$.subscribe((list) => {
      this.collaborators = list;
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy(): void {
    this.collaboratorsSub?.unsubscribe();
  }
  // Método invocado desde la plantilla. Alias en español para compatibilidad.
  ejecutarCodigo(): void {
    this.onRunCode();
  }

  onLanguageChange(newLang: string): void {
    this.language = newLang;
  }

  onEditorValueChange(newValue: string): void {
    this.value = newValue;
    if (this.selectedRoom) {
      this.roomContentCache.set(this.selectedRoom, newValue);
    }
  }

  async selectProject(projectId: number): Promise<void> {
    const requestId = ++this.selectionRequestId;
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) return;

    this.cacheCurrentRoomContent();
    await this.saveCurrentArchivo();
    if (requestId !== this.selectionRequestId) return;

    if (project.id < 0) {
      this.selectedProjectId = project.id;
      this.selectedArchivoId = project.archivos?.[0]?.id ?? null;
      this.projectId = '';
      this.selectedRoom = '';
      this.lspEnabled = false;
      this.languageDisabled = false;
      this.fallbackMode = true;
      if (project.archivos?.[0]) {
        this.value = project.archivos[0].contenido ?? this.value;
        this.currentFilePathBase = this.stripFileExtension(project.archivos[0].nombre);
      }
      this.cdr.detectChanges();
      return;
    }

    this.selectedProjectId = project.id;
    this.projectId = String(project.id);
    this.language = this.mapProjectLanguage(project.lenguaje);
    this.lspEnabled = true;
    this.languageDisabled = true;
    this.fallbackMode = false;
    this.cdr.detectChanges();

    if (!project.archivos || project.archivos.length === 0) {
      this.selectedArchivoId = null;
      this.selectedRoom = '';
      this.value = '';
      this.lspEnabled = false;
      this.cdr.detectChanges();
      return;
    }

    if (requestId !== this.selectionRequestId) return;

    // Conectar a la sala del proyecto para sincronizar metadata (lista de archivos)
    try {
      const projectTokenRes = await this.auth.getCollabToken(project.id);
      await this.collab.connectProject(project.id, projectTokenRes.token, projectTokenRes.username, projectTokenRes.userId);

      // Si existe el array compartido 'files', observar cambios y refrescar desde backend
      const filesArr = this.collab.getProjectFilesArray(project.id);
      if (filesArr) {
        // Observador que recarga la lista de archivos desde el backend
        filesArr.observe(async () => {
          try {
            const fresh = await this.workspace.getProject(project.id);
            const idx = this.projects.findIndex((p) => p.id === project.id);
            if (idx >= 0) {
              const freshArch = fresh.archivos ?? [];
              this.projects[idx].archivos = freshArch;
              if (this.selectedArchivoId && !freshArch.find((a) => a.id === this.selectedArchivoId)) {
                if (freshArch.length > 0) {
                  this.selectedArchivoId = freshArch[0].id;
                } else {
                  this.selectedArchivoId = null;
                  this.selectedRoom = '';
                  this.value = '';
                  this.lspEnabled = false;
                }
              }
              this.cdr.detectChanges();
            }
          } catch (e) {
            console.warn('[Editor] Could not refresh project files on project-array change', e);
          }
        });
      }

    } catch (e) {
      console.warn('[Editor] Could not connect to project-level collab room', e);
    }

    await this.selectArchivo(project.archivos[0].id);
  }

  async selectArchivo(archivoId: number): Promise<void> {
    const requestId = ++this.selectionRequestId;

    if (this.selectedArchivoId === archivoId && this.selectedProjectId !== null) {
      return;
    }

    this.cacheCurrentRoomContent();
    await this.saveCurrentArchivo();
    if (requestId !== this.selectionRequestId) return;

    const project = this.projects.find((item) => item.id === this.selectedProjectId);
    const archivo = project?.archivos?.find((item) => item.id === archivoId);
    if (!project || !archivo) return;

    if (requestId !== this.selectionRequestId) return;

    this.selectedArchivoId = archivo.id;
    const selectedRoom = `${project.id}:${archivo.id}`;
    this.value = this.roomContentCache.get(selectedRoom) ?? archivo.contenido ?? this.defaultCodeForLanguage(this.language);
    this.selectedRoom = selectedRoom;
    this.currentFilePathBase = this.stripFileExtension(archivo.nombre);
    this.projectId = String(project.id);
    this.roomContentCache.set(selectedRoom, this.value);
    this.cdr.detectChanges();

    if (project.id < 0 || archivo.id < 0) {
      return;
    }

    if (requestId !== this.selectionRequestId) return;
    const { token, username, userId } = await this.auth.getCollabToken(project.id, archivo.id);
    if (requestId !== this.selectionRequestId) return;
    await this.connectCollab(token, username, userId);
  }

  startResize(ev: MouseEvent): void {
    // Placeholder: se puede manejar arrastrar tamaño del terminal desde aquí.
    console.log('[Editor] startResize', ev.type);
  }

  private async loadWorkspace(): Promise<void> {
    try {
      console.log('[Editor] Fetching projects from backend...');
      const projects = await this.workspace.listProjects();
      console.log('[Editor] Projects received:', projects.length > 0 ? projects : 'empty array');
      this.projects = projects;
      this.cdr.detectChanges();

      if (this.projects.length === 0) {
        console.log('[Editor] No projects found, creating starter workspace...');
        try {
          const created = await this.createStarterWorkspace();
          console.log('[Editor] Starter workspace created:', created.id);
          this.projects = [created];
        } catch (createError) {
          console.error('[Editor] Failed to create starter workspace, using local fallback:', createError);
          this.useLocalFallbackProject();
          return;
        }
      }

      // If still no projects after attempts, use local fallback
      if (this.projects.length === 0) {
        console.log('[Editor] Using local fallback project');
        this.useLocalFallbackProject();
        return;
      }

      const firstProject = this.projects[0];
      if (!firstProject) {
        this.useLocalFallbackProject();
        return;
      }

      console.log('[Editor] Selecting first project:', firstProject.id);
      await this.selectProject(firstProject.id);
    } catch (error) {
      console.error('[Editor] Fatal error in loadWorkspace:', error);
      this.useLocalFallbackProject();
    }
  }

  private useLocalFallbackProject(): void {
    const fallbackArchivo = {
      id: -1,
      nombre: 'main.cpp',
      contenido: this.value,
    };

    const fallbackProject: WorkspaceProyecto = {
      id: -1,
      nombre: 'Proyecto local',
      descripcion: 'Fallback local - sincronización no disponible',
      lenguaje: 'CPP',
      archivos: [fallbackArchivo],
    };

    this.projects = [fallbackProject];
    this.selectedProjectId = fallbackProject.id;
    this.selectedArchivoId = fallbackArchivo.id;
    this.selectedRoom = `${fallbackProject.id}:${fallbackArchivo.id}`;
    this.currentFilePathBase = this.stripFileExtension(fallbackArchivo.nombre);
    this.projectId = '';
    this.lspEnabled = false;
    this.languageDisabled = false;
    this.fallbackMode = true;
    this.cdr.detectChanges();
  }

  private async createStarterWorkspace(): Promise<WorkspaceProyecto> {
    try {
      console.log('[Editor] Creating starter project...');
      const project = await this.workspace.createProject({
        nombre: 'Proyecto principal',
        descripcion: 'Proyecto inicial creado automáticamente',
        lenguaje: this.mapLanguageToProject(this.language),
      });
      console.log('[Editor] Project created:', project);

      const archivo = await this.workspace.createArchivo(project.id, {
        nombre: this.defaultFileNameForLanguage(this.language),
        contenido: this.defaultCodeForLanguage(this.language),
      });
      console.log('[Editor] Archivo created:', archivo);

      return { ...project, archivos: [archivo] };
    } catch (error) {
      console.error('[Editor] Failed to create starter workspace:', error);
      throw error;
    }
  }
  async createFileInSelectedProject(): Promise<void> {
    const project = this.projects.find((item) => item.id === this.selectedProjectId);
    if (!project || project.id < 0) {
      console.warn('[Editor] No se puede crear archivo: proyecto local o no seleccionado');
      return;
    }

    this.cacheCurrentRoomContent();
    await this.saveCurrentArchivo();

    const existingNames = new Set((project.archivos ?? []).map((archivo) => archivo.nombre));
    const baseName = this.defaultFileNameForLanguage(this.language);
    const candidateNames = [
      baseName,
      `main-2${this.fileExtensionForLanguage(this.language)}`,
      `main-3${this.fileExtensionForLanguage(this.language)}`,
      `file-${Date.now()}${this.fileExtensionForLanguage(this.language)}`,
    ];
    const nombre = candidateNames.find((name) => !existingNames.has(name)) ?? `file-${Date.now()}${this.fileExtensionForLanguage(this.language)}`;

    try {
      const archivo = await this.workspace.createArchivo(project.id, {
        nombre,
        contenido: this.defaultCodeForLanguage(this.language),
      });

      project.archivos = [...(project.archivos ?? []), archivo];
      this.selectedArchivoId = archivo.id;
      this.value = archivo.contenido;
      this.currentFilePathBase = this.stripFileExtension(archivo.nombre);
      this.projectId = String(project.id);
      this.selectedRoom = `${project.id}:${archivo.id}`;
      this.roomContentCache.set(this.selectedRoom, this.value);
      this.lspEnabled = true;
      this.cdr.detectChanges();

      const { token, username, userId } = await this.auth.getCollabToken(project.id, archivo.id);
      await this.connectCollab(token, username, userId);

      // Notify other clients via project-level Y.Array if available
      try {
        this.collab.pushProjectFile(project.id, { id: archivo.id, nombre: archivo.nombre });
      } catch (e) {
        // ignore if push fails
      }
    } catch (error: any) {
      const message = error?.error?.detail
        || error?.error?.nombre?.[0]
        || error?.message
        || 'No se pudo crear el archivo. Revise los logs del backend.';
      console.error('[Editor] Error al crear archivo:', error);
      alert(`Error al crear archivo:\n${message}`);
    }
  }

  /** Activa el modo de edición inline para renombrar un archivo. */
  startRename(archivo: WorkspaceArchivo): void {
    this.renamingArchivoId = archivo.id;
    this.renamingName = archivo.nombre;
  }

  /** Cancela la edición inline sin guardar cambios. */
  cancelRename(): void {
    this.renamingArchivoId = null;
    this.renamingName = '';
  }

  /** Guarda el nuevo nombre vía PATCH, actualiza estado local y notifica peers. */
  async commitRename(archivoId: number): Promise<void> {
    const project = this.projects.find((item) => item.id === this.selectedProjectId);
    if (!project || project.id < 0) return;

    const archivo = project.archivos?.find((a) => a.id === archivoId);
    if (!archivo) return;

    const newName = this.renamingName.trim();
    if (!newName || newName === archivo.nombre) {
      this.cancelRename();
      return;
    }

    try {
      const updated = await this.workspace.updateArchivo(project.id, archivoId, { nombre: newName });
      archivo.nombre = updated.nombre;
      if (this.selectedArchivoId === archivoId) {
        this.currentFilePathBase = this.stripFileExtension(updated.nombre);
        const oldRoom = this.selectedRoom;
        this.selectedRoom = `${project.id}:${archivoId}`;
        this.roomContentCache.delete(oldRoom);
        this.roomContentCache.set(this.selectedRoom, this.value);
        this.cdr.detectChanges();
      }
      this.collab.renameProjectFile(project.id, archivoId, newName);
      this.cancelRename();
    } catch (error: any) {
      const message = error?.error?.nombre?.[0]
        || error?.error?.detail
        || error?.message
        || 'No se pudo renombrar el archivo.';
      alert(`Error al renombrar:\n${message}`);
    }
  }

  /** Elimina un archivo con confirmación, ajusta selección y notifica peers.
   * Si es el último archivo, el proyecto queda vacío (sin archivo seleccionado). */
  async deleteArchivo(archivoId: number): Promise<void> {
    const project = this.projects.find((item) => item.id === this.selectedProjectId);
    if (!project || project.id < 0) return;
    const archivo = project.archivos?.find((a) => a.id === archivoId);
    if (!archivo) return;

    if (!confirm(`¿Eliminar el archivo "${archivo.nombre}"?`)) return;

    this.cacheCurrentRoomContent();
    await this.saveCurrentArchivo();

    try {
      await this.workspace.deleteArchivo(project.id, archivoId);
      project.archivos = (project.archivos ?? []).filter((a) => a.id !== archivoId);

      if (this.selectedArchivoId === archivoId) {
        this.collab.disconnect();
        const remaining = project.archivos;
        if (remaining.length > 0) {
          await this.selectArchivo(remaining[0].id);
        } else {
          this.selectedArchivoId = null;
          this.selectedRoom = '';
          this.value = '';
          this.lspEnabled = false;
          this.roomContentCache.delete(`${project.id}:${archivoId}`);
          this.cdr.detectChanges();
        }
      }

      this.collab.deleteProjectFile(project.id, archivoId);
    } catch (error: any) {
      const message = error?.error?.detail
        || error?.message
        || 'No se pudo eliminar el archivo.';
      alert(`Error al eliminar:\n${message}`);
    }
  }

  private async connectCollab(token: string, username: string, userId: string): Promise<void> {
    await this.collab.connect(this.selectedRoom, token, username, userId);
  }

  private async saveCurrentArchivo(): Promise<void> {
    const project = this.projects.find((item) => item.id === this.selectedProjectId);
    const archivo = project?.archivos?.find((item) => item.id === this.selectedArchivoId);

    if (!project || !archivo || project.id < 0 || archivo.id < 0) {
      return;
    }

    const contenido = this.roomContentCache.get(`${project.id}:${archivo.id}`) ?? this.value;

    if (archivo.contenido === contenido) {
      return;
    }

    try {
      const updated = await this.workspace.updateArchivo(project.id, archivo.id, { contenido });
      archivo.contenido = updated.contenido;
    } catch (error) {
      console.warn('[Editor] No se pudo guardar el archivo actual antes de cambiar:', error);
    }
  }

  private mapProjectLanguage(language: WorkspaceProyecto['lenguaje']): string {
    const mapping: Record<WorkspaceProyecto['lenguaje'], string> = {
      CPP: 'cpp',
      PYTHON: 'python',
      TYPESCRIPT: 'typescript',
    };
    return mapping[language] ?? 'cpp';
  }

  private mapLanguageToProject(language: string): WorkspaceProyecto['lenguaje'] {
    if (language === 'python') return 'PYTHON';
    if (language === 'typescript') return 'TYPESCRIPT';
    return 'CPP';
  }

  private defaultFileNameForLanguage(language: string): string {
    const mapping: Record<string, string> = {
      cpp: 'main.cpp',
      python: 'main.py',
      typescript: 'main.ts',
      javascript: 'main.js',
    };
    return mapping[language] ?? 'main.txt';
  }

  private fileExtensionForLanguage(language: string): string {
    const mapping: Record<string, string> = {
      cpp: '.cpp',
      python: '.py',
      typescript: '.ts',
      javascript: '.js',
    };
    return mapping[language] ?? '.txt';
  }

  private defaultCodeForLanguage(language: string): string {
    if (language === 'python') {
      return 'print("Hola Python")\n';
    }
    if (language === 'typescript' || language === 'javascript') {
      return 'console.log("Hola JS");\n';
    }
    return `#include <iostream>\n\nint main() {\n    std::cout << "Hola C++" << std::endl;\n    return 0;\n}`;
  }

  private stripFileExtension(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, '') || 'main';
  }

  private cacheCurrentRoomContent(): void {
    if (!this.selectedRoom) {
      return;
    }

    this.roomContentCache.set(this.selectedRoom, this.value);
  }

  /** Cierra sesión: guarda archivo actual, desconecta collab y redirige a /auth. */
  onLogout(): void {
    this.cacheCurrentRoomContent();
    this.saveCurrentArchivo();
    this.collab.disconnect();
    this.auth.logout();
  }

  enviarEntrada(input: string): void {
    this.executionService.sendInput(input);
  }

  private onRunCode(): void {
    this.resultado = undefined;
    this.resultadoOk = undefined;
    this.cargando = true;
    this.cdr.detectChanges();

    const sharedCode = this.collab.getSharedText('codemirror')?.toString();
    const codeToRun = sharedCode && sharedCode.length > 0 ? sharedCode : this.value;
    let accumulated = '';

    this.executionService.connect(
      (message) => {
        switch (message.type) {
          case 'output':
            accumulated += message.data;
            this.resultado = accumulated;
            break;
          case 'dequeued':
            accumulated += message.data || '';
            break;
          case 'error':
            accumulated += '\n[error] ' + message.data;
            break;
          case 'finished':
            this.cargando = false;
            this.resultado = accumulated;
            this.resultadoOk = message.exitCode === 0;
            this.cdr.detectChanges();
            break;
          default:
            // otros mensajes: queued, started, timeout
            break;
        }
      },
      () => {
        // onError
        this.cargando = false;
        this.resultado = 'Error: conexión de ejecución fallida';
        this.cdr.detectChanges();
      },
      () => {
        // onClose
        this.cargando = false;
        this.cdr.detectChanges();
      },
    );

    // Enviar petición de ejecución
    this.executionService.runCode(this.language, codeToRun);
  }

  private limpiarResultado(resultado: string): string {
    return resultado.replace(/^id\s*=\s*[^|]*\|\s*/i, '');
  }

  private extraerEstadoOk(resultado: string): boolean | undefined {
    const match = resultado.match(/(^|\n)\s*ok\s*=\s*(true|false)\s*(\n|$)/i);
    if (!match) return undefined;
    return match[2].toLowerCase() === 'true';
  }

  private formatearSalida(resultado: string, tiempo?: string): string {
    return `${resultado}\ntiempo=${tiempo ?? 'N/A'}`;
  }
}

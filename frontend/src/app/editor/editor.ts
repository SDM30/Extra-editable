import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { finalize, timeout } from 'rxjs';
import { Extension } from '@codemirror/state';

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
  imports: [Header, CodeSection],
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
    { label: 'JavaScript', value: 'javascript' },
    { label: 'Python', value: 'python' },
  ];

  resultado?: string;
  resultadoOk?: boolean;
  cargando = false;
  projectId: string = 'default-project';
  projects: WorkspaceProyecto[] = [];
  selectedProjectId: number | null = null;
  selectedArchivoId: number | null = null;
  selectedRoom = 'default-project:main';
  currentFilePathBase = 'main';
  lspEnabled: boolean = true;
  terminalHeight: number = 220;
  collaborators: Array<{ userId: string; username: string; color: string }> = [];
  private collaboratorsSub?: Subscription;

  constructor(
    private executionService: ExecutionService,
    private cdr: ChangeDetectorRef,
    private collab: CollabService,
    private auth: AuthService,
    private workspace: WorkspaceService,
  ) {}

  async ngOnInit() {
    console.log('[Editor] solicitando token collab...');
    // Obtiene (o genera) la identidad del usuario y pide el token al servidor collab
    await this.loadWorkspace();

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

  async selectProject(projectId: number): Promise<void> {
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) return;

    this.selectedProjectId = project.id;
    this.projectId = String(project.id);
    this.language = this.mapProjectLanguage(project.lenguaje);

    if (!project.archivos || project.archivos.length === 0) {
      const created = await this.ensureDefaultArchivo(project);
      project.archivos = [created];
    }

    await this.selectArchivo(project.archivos[0].id);
  }

  async selectArchivo(archivoId: number): Promise<void> {
    const project = this.projects.find((item) => item.id === this.selectedProjectId);
    const archivo = project?.archivos?.find((item) => item.id === archivoId);
    if (!project || !archivo) return;

    this.selectedArchivoId = archivo.id;
    this.value = archivo.contenido || this.defaultCodeForLanguage(this.language);
    this.selectedRoom = `${project.id}:${archivo.id}`;
    this.currentFilePathBase = this.stripFileExtension(archivo.nombre);
    this.projectId = String(project.id);
    this.cdr.detectChanges();

    const { token, username, userId } = await this.auth.getCollabToken();
    await this.connectCollab(token, username, userId);
  }

  startResize(ev: MouseEvent): void {
    // Placeholder: se puede manejar arrastrar tamaño del terminal desde aquí.
    console.log('[Editor] startResize', ev.type);
  }

  private async loadWorkspace(): Promise<void> {
    try {
      const projects = await this.workspace.listProjects();
      this.projects = projects;

      if (this.projects.length === 0) {
        const created = await this.createStarterWorkspace();
        this.projects = [created];
      }

      await this.selectProject(this.projects[0].id);
    } catch (error) {
      console.warn('[Editor] No se pudo cargar el workspace remoto:', error);
      const fallbackProject: WorkspaceProyecto = {
        id: 0,
        nombre: 'Proyecto local',
        descripcion: 'Fallback local mientras no hay backend autenticado',
        lenguaje: 'CPP',
        archivos: [
          {
            id: 0,
            nombre: 'main.cpp',
            contenido: this.value,
          },
        ],
      };
      this.projects = [fallbackProject];
      this.selectedProjectId = fallbackProject.id;
      this.selectedArchivoId = fallbackProject.archivos?.[0]?.id ?? null;
      this.selectedRoom = `${fallbackProject.id}:${this.selectedArchivoId ?? 0}`;
      this.projectId = String(fallbackProject.id);
      this.cdr.detectChanges();
    }
  }

  private async createStarterWorkspace(): Promise<WorkspaceProyecto> {
    const project = await this.workspace.createProject({
      nombre: 'Proyecto principal',
      descripcion: 'Proyecto inicial creado automáticamente',
      lenguaje: this.mapLanguageToProject(this.language),
    });

    const archivo = await this.workspace.createArchivo(project.id, {
      nombre: this.defaultFileNameForLanguage(this.language),
      contenido: this.defaultCodeForLanguage(this.language),
    });

    return { ...project, archivos: [archivo] };
  }

  private async ensureDefaultArchivo(project: WorkspaceProyecto): Promise<WorkspaceArchivo> {
    return this.workspace.createArchivo(project.id, {
      nombre: this.defaultFileNameForLanguage(this.language),
      contenido: this.defaultCodeForLanguage(this.language),
    });
  }

  private async connectCollab(token: string, username: string, userId: string): Promise<void> {
    await this.collab.connect(this.selectedRoom, token, username, userId);
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
    if (language === 'typescript' || language === 'javascript') return 'TYPESCRIPT';
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
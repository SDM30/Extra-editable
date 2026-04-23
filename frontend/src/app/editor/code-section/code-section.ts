import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CodeEditor } from '@acrodata/code-editor';
import { Extension } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { yCollab } from 'y-codemirror.next';
import { UndoManager } from 'yjs';
import { Subscription } from 'rxjs';
import { CollabService } from '../../services/collab.service';

export type Theme = 'light' | 'dark' | Extension;

@Component({
  selector: 'app-code-section',
  standalone: true,
  imports: [FormsModule, CodeEditor],
  templateUrl: './code-section.html',
  styleUrl: './code-section.css',
})
export class CodeSection implements OnInit, OnDestroy {

  private collab = inject(CollabService);
  private cdr = inject(ChangeDetectorRef);
  private readySub?: Subscription;

  private _value = '';
  @Input() set value(val: string) { this._value = val; }
  get value(): string { return this._value; }
  @Output() valueChange = new EventEmitter<string>();

  @Input() theme: Theme = 'light';
  @Input() language: string = 'cpp';
  @Input() resultado?: string;
  @Input() resultadoOk?: boolean;
  @Input() cargando: boolean = false;

  isProblemCollapsed = false;
  yjsReady = false;

  // Empieza solo con el lenguaje; se reemplaza completo cuando Yjs está listo
  private _extensions: Extension[] = [cpp()];
  get editorExtensions(): Extension[] {
    return this._extensions;
  }

  ngOnInit() {
    this.readySub = this.collab.ready$.subscribe(() => {
      const ytext = this.collab.getSharedText();
      const provider = this.collab.getProvider();

      if (!ytext || !provider) return;

      // Si el Y.Text está vacío (primera persona en entrar),
      // carga el código inicial para que los demás lo vean
      if (ytext.length === 0 && this._value) {
        ytext.insert(0, this._value);
      }

      const undoManager = new UndoManager(ytext);
      const yjsExt = yCollab(ytext, provider.awareness, { undoManager });

      // Reemplaza las extensiones incluyendo Yjs
      this._extensions = [this.languageExtension(), yjsExt];
      this.yjsReady = true;

      // Fuerza a Angular a re-renderizar con las nuevas extensiones
      this.cdr.detectChanges();
      console.log('[collab] Binding Yjs+CodeMirror activo');
    });
  }

  ngOnDestroy() {
    this.readySub?.unsubscribe();
  }

  onValueChange(newValue: string) {
    this.valueChange.emit(newValue);
  }

  toggleProblem(): void {
    this.isProblemCollapsed = !this.isProblemCollapsed;
  }

  private languageExtension(): Extension {
    switch (this.language) {
      case 'cpp': return cpp();
      case 'javascript': return javascript();
      case 'python': return python();
      default: return cpp();
    }
  }
}
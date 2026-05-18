import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Extension } from '@codemirror/state';

export type Theme = 'light' | 'dark' | Extension;

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './headerIDE.html',
  styleUrl: './headerIDE.css',
})
export class Header {
  @Input() theme!: Theme;
  @Input() themeOptions: { label: string; value: Theme }[] = [];

  @Input() language!: string;
  @Input() languageOptions: { label: string; value: string }[] = [];
  @Input() languageDisabled = false;

  @Output() themeChange = new EventEmitter<Theme>();
  @Output() languageChange = new EventEmitter<string>();

  @Output() runCode = new EventEmitter<void>();  // ← Evento para ejecutar código
  @Output() logout = new EventEmitter<void>();

  onRunClick() {
    console.log('Botón Run clickeado');
    this.runCode.emit();  // Emitir evento al componente padre
  }

  onLogoutClick() {
    this.logout.emit();
  }
}
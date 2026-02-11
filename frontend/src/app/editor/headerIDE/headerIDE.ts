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

  @Output() themeChange = new EventEmitter<Theme>();
  @Output() languageChange = new EventEmitter<string>();
}

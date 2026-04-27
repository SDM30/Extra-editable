import { Routes } from '@angular/router';
import { Editor } from './editor/editor';

export const routes: Routes = [
  {
    path: '',
    component: Editor,
    title: 'Home page',
  },
];

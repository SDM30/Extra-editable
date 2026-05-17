import { Routes } from '@angular/router';
import { Editor } from './editor/editor';

export const routes: Routes = [
  {
    path: 'editor',
    component: Editor,
    title: 'Editor',
  },
  { path: 'auth', loadComponent: () => import('./auth/auth-wrap/auth-wrap.component').then(m => m.AuthWrapComponent) },
  { path: '', redirectTo: '/auth', pathMatch: 'full' },
  { path: '**', redirectTo: '/auth' },
];

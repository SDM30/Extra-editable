import { Routes } from '@angular/router';
import { Editor } from './editor/editor';
import { ProjectSelector } from './project-selector/project-selector';

export const routes: Routes = [
  {
    path: 'projects',
    component: ProjectSelector,
    title: 'Mis Proyectos',
  },
  {
    path: 'editor/:projectId',
    component: Editor,
    title: 'Editor',
  },
  { path: 'auth', loadComponent: () => import('./auth/auth-wrap/auth-wrap.component').then(m => m.AuthWrapComponent) },
  { path: '', redirectTo: '/auth', pathMatch: 'full' },
  { path: '**', redirectTo: '/auth' },
];

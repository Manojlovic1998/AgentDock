import { Routes } from '@angular/router';
import { Browser } from './features/browser/browser';
import { Changes } from './features/changes/changes';
import { Overview } from './features/overview/overview';
import { Settings } from './features/settings/settings';
import { Validation } from './features/validation/validation';
import { Workspace } from './features/workspace/workspace';

export const routes: Routes = [
  { path: 'workspace', component: Workspace },
  { path: 'overview', component: Overview },
  { path: 'resources/:kind', component: Browser },
  { path: 'validation', component: Validation },
  { path: 'changes', component: Changes },
  { path: 'settings', component: Settings },
  { path: '**', redirectTo: 'workspace' },
];

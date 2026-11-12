import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { ElectronResourceRepository, MockResourceRepository, ResourceRepository } from './core/data/resource-repository';
import { WorkspaceStore } from './core/state/workspace.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hash URLs keep routing working when the app is loaded from file:// in Electron.
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
    // Real files inside the desktop app, sample data in a plain browser.
    { provide: ResourceRepository, useClass: window.agentDock?.scan ? ElectronResourceRepository : MockResourceRepository },
    // The first render already has the workspace, so no screen needs a loading state.
    provideAppInitializer(() => inject(WorkspaceStore).init()),
  ],
};

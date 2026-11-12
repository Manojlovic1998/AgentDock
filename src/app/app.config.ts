import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { MockResourceRepository, ResourceRepository } from './core/data/resource-repository';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hash URLs keep routing working when the app is loaded from file:// in Electron.
    provideRouter(routes, withHashLocation(), withComponentInputBinding()),
    { provide: ResourceRepository, useClass: MockResourceRepository },
  ],
};

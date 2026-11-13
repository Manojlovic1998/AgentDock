import { defineConfig } from 'vitest/config';

/**
 * Vitest setup for the Electron main process. The Angular unit-test builder only collects specs
 * under `src/`, so the specs in `electron/` run with this config: `npm run test:electron`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/**/*.spec.ts'],
    testTimeout: 15000,
  },
});

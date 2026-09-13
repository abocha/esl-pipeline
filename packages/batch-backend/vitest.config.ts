import path from 'node:path';
import { defineConfig } from 'vitest/config';

import { BACKEND_TEST_PROJECTS } from './vitest.projects.mjs';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    env: {
      PIPELINE_CWD: path.resolve(import.meta.dirname, '../..'),
    },
    environment: 'node',
    globals: true,
    clearMocks: false,
    exclude: ['**/dist/**', '**/node_modules/**'],
    projects: BACKEND_TEST_PROJECTS,
  },
});

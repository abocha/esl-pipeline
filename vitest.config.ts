import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      PIPELINE_CWD: import.meta.dirname,
    },
    globals: true,
    clearMocks: false,
    environment: 'node',
    exclude: ['**/dist/**', '**/node_modules/**', '**/tests/e2e/**', '**/tests/e2e-real/**'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}', 'packages/**/src/**/*.{ts,tsx}'],
    },
  },
});

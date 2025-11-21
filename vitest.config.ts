import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/dist/**', '**/node_modules/**'],
    coverage: { reporter: ['text', 'html'], include: ['packages/**/src/**/*.ts'] },
  },
});

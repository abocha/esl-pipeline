import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: [
      '**/dist/**',
      '**/node_modules/**',
      '**/tests/e2e/**',
      '**/tests/e2e-real/**',
    ],
  },
});

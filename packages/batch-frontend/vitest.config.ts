import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: [
      '**/dist/**',
      '**/node_modules/**',
      '**/tests/e2e/**',
      '**/tests/e2e-real/**',
    ],
  },
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Publication and orchestration must resolve the same uploader module for mocks.
    // pnpm's injected workspace copies otherwise create separate module identities.
    alias: {
      '@esl-pipeline/html-publisher': fileURLToPath(
        new URL('./packages/html-publisher/dist/src/index.js', import.meta.url),
      ),
      '@esl-pipeline/storage-uploader': fileURLToPath(
        new URL('./packages/storage-uploader/dist/src/index.js', import.meta.url),
      ),
    },
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

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadApplicationEnv } from '@esl-pipeline/shared-infrastructure';

export function loadBatchBackendEnv(moduleUrl: string, memoizeKey: string): void {
  // Isolated Vitest projects own a deliberately scrubbed environment. Do not let a later module
  // bootstrap repopulate repository-local service or provider values after project setup.
  if (process.env.BATCH_BACKEND_TEST_ENV_LOCKED === 'true') return;

  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const repoRoot = path.resolve(moduleDir, '../../../..');
  loadApplicationEnv({
    moduleUrl,
    cwd: repoRoot,
    memoizeKey,
  });
}

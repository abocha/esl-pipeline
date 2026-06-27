import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadApplicationEnv } from '@esl-pipeline/shared-infrastructure';

export function loadBatchBackendEnv(moduleUrl: string, memoizeKey: string): void {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const repoRoot = path.resolve(moduleDir, '../../../..');
  loadApplicationEnv({
    moduleUrl,
    cwd: repoRoot,
    memoizeKey,
  });
}

import { loadCliEnv } from '@esl-pipeline/shared-infrastructure';

export function loadBatchBackendEnv(moduleUrl: string, memoizeKey: string): void {
  loadCliEnv({
    moduleUrl,
    files: ['.env.batch-backend', '.env'],
    memoizeKey,
  });
}

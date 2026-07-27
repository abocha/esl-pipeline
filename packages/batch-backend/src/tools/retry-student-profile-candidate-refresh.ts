import { pathToFileURL } from 'node:url';

import { retryStudentProfileCandidateRefreshForSnapshot } from '../application/retry-student-profile-candidate-refresh.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { loadConfig } from '../config/env.js';
import { closeStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';

interface CliOptions {
  snapshotId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseArgs(argv: string[]): CliOptions {
  let snapshotId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || arg === '--') continue;
    if (arg !== '--snapshot-id') {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (snapshotId) {
      throw new Error('--snapshot-id may be provided only once');
    }
    const value = argv[index + 1]?.trim();
    if (!value) {
      throw new Error('Missing value for --snapshot-id');
    }
    if (!UUID_PATTERN.test(value)) {
      throw new Error('--snapshot-id must be a valid UUID');
    }
    snapshotId = value;
    index += 1;
  }

  if (!snapshotId) {
    throw new Error('--snapshot-id is required');
  }
  return { snapshotId };
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  loadBatchBackendEnv(
    import.meta.url,
    'batch-backend-tool-retry-student-profile-candidate-refresh',
  );
  const config = loadConfig();
  if (!config.pg.enabled) {
    throw new Error('PG_ENABLED=true is required');
  }

  const result = await retryStudentProfileCandidateRefreshForSnapshot({
    snapshotId: options.snapshotId,
  });
  console.log(
    `[student-profile-candidate-refresh-retry] snapshot=${result.snapshotId} outcome=${result.outcome}`,
  );
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void run()
    .finally(() => closeStudentMemoryQueue())
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[student-profile-candidate-refresh-retry] failed: ${message}`);
      process.exitCode = 1;
    });
}

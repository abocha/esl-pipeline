import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { remapCanonicalAssignmentSource } from '../domain/assignment-session-repository.js';
import { closePgPool } from '../infrastructure/db.js';

function readRequiredArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

export async function main(): Promise<void> {
  if (!process.argv.includes('--apply')) {
    throw new Error(
      'Refusing to mutate ownership without --apply. Required: --user-id, --target-session-id, --reason.',
    );
  }
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-remap-assignment-source');
  const result = await remapCanonicalAssignmentSource({
    userId: readRequiredArg('--user-id'),
    targetSessionId: readRequiredArg('--target-session-id'),
    reason: readRequiredArg('--reason'),
  });
  console.log(
    JSON.stringify({
      changed: result.changed,
      previousSessionId: result.previousSessionId,
      canonicalSessionId: result.session.id,
    }),
  );
}

if (
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => closePgPool());
}

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyCalendarCutover,
  type CalendarCutoverManifest,
  planCalendarCutover,
} from '../application/calendar-cutover.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { closePgPool } from '../infrastructure/db.js';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? null : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

export async function main(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'calendar-cutover');
  const workspaceId = argument('--workspace-id');
  const manifestPath = path.resolve(argument('--manifest'));
  if (process.argv.includes('--plan') === process.argv.includes('--apply')) {
    throw new Error(
      'Choose exactly one of --plan or --apply. Production apply requires separate operator authorization.',
    );
  }
  if (process.argv.includes('--plan')) {
    const manifest = await planCalendarCutover(workspaceId);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        fingerprint: manifest.fingerprint,
        eligible: manifest.lessons.filter((lesson) => lesson.eligible).length,
        protected: manifest.lessons.filter((lesson) => !lesson.eligible).length,
        rules: manifest.plans.flatMap((plan) => plan.ruleIds).length,
      }),
    );
  } else {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as CalendarCutoverManifest;
    if (manifest.workspaceId !== workspaceId) throw new Error('Manifest workspace mismatch.');
    const result = await applyCalendarCutover(manifest, argument('--confirm-fingerprint'));
    console.log(JSON.stringify(result));
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main()
    .catch(() => {
      console.error('Calendar cutover failed; verify schema, authorization and manifest drift.');
      process.exitCode = 1;
    })
    .finally(() => closePgPool());
}

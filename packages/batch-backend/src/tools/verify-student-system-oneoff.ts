import { randomUUID } from 'node:crypto';

import {
  createStudentProfile,
  deleteStudentProfile,
  getStudentProfileById,
  listStudentProfiles,
  updateStudentProfile,
} from '../application/student-profiles-store.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { configureHostRunPgRuntimeEnv } from '../bootstrap/pg-host-run-env.js';
import { loadConfig } from '../config/env.js';
import { getProfileById } from '../domain/profile-repository.js';
import { getActiveStudentProfileBinding } from '../domain/student-profile-binding-repository.js';

interface CliOptions {
  keep: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { keep: false };

  for (const arg of argv) {
    if (!arg || arg === '--') continue;
    if (arg === '--keep') {
      options.keep = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function assertOrThrow(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function run(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-verify-student-system-oneoff');
  configureHostRunPgRuntimeEnv();
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  if (!config.pg.enabled) {
    throw new Error('Verification requires Postgres (PG_ENABLED=true)');
  }

  if (config.orchestrator.configProvider === 'http') {
    throw new Error(
      'Verification requires local config provider (ESL_PIPELINE_CONFIG_PROVIDER=local)',
    );
  }

  const suffix = randomUUID().slice(0, 8);
  const studentName = `PhaseA Oneoff ${suffix}`;
  const firstProfileId = `profiles/phase-a-oneoff-${suffix}.md`;
  const secondProfileId = `profiles/phase-a-oneoff-${suffix}-updated.md`;

  let createdStudentId: string | null = null;

  try {
    console.log('[student-system-verify] step=create');
    const created = await createStudentProfile(
      {
        student: studentName,
        colorPreset: 'b1-default',
        profileId: firstProfileId,
        voices: {
          narrator: 'voice-test',
        },
      },
      { config },
    );
    createdStudentId = created.id;

    assertOrThrow(created.student === studentName, 'Created student name mismatch');
    assertOrThrow(created.profileId === firstProfileId, 'Created profileId mismatch');

    console.log('[student-system-verify] step=get');
    const loaded = await getStudentProfileById(created.id, { config });
    assertOrThrow(loaded, 'Expected created student to be retrievable');
    assertOrThrow(loaded.profileId === firstProfileId, 'Loaded profileId mismatch');

    console.log('[student-system-verify] step=list-search');
    const listed = await listStudentProfiles(
      { search: suffix, limit: 20, offset: 0, order: 'asc' },
      { config },
    );
    assertOrThrow(
      listed.items.some((item) => item.id === created.id),
      'List did not include created student',
    );

    console.log('[student-system-verify] step=binding-check-initial');
    const initialBinding = await getActiveStudentProfileBinding(created.id);
    assertOrThrow(initialBinding, 'Expected active binding after create');
    assertOrThrow(
      initialBinding.profileId === firstProfileId,
      'Initial binding profileId mismatch',
    );

    console.log('[student-system-verify] step=profile-record-check-initial');
    const initialProfileRecord = await getProfileById(firstProfileId);
    assertOrThrow(initialProfileRecord, 'Expected profile record for initial profileId');

    console.log('[student-system-verify] step=update');
    const updated = await updateStudentProfile(
      created.id,
      {
        colorPreset: 'c1-default',
        profileId: secondProfileId,
      },
      { config },
    );
    assertOrThrow(updated, 'Expected update to return student');
    assertOrThrow(updated.profileId === secondProfileId, 'Updated profileId mismatch');
    assertOrThrow(updated.colorPreset === 'c1-default', 'Updated color preset mismatch');

    console.log('[student-system-verify] step=binding-check-updated');
    const updatedBinding = await getActiveStudentProfileBinding(created.id);
    assertOrThrow(updatedBinding, 'Expected active binding after update');
    assertOrThrow(
      updatedBinding.profileId === secondProfileId,
      'Updated binding profileId mismatch',
    );

    console.log('[student-system-verify] step=profile-record-check-updated');
    const updatedProfileRecord = await getProfileById(secondProfileId);
    assertOrThrow(updatedProfileRecord, 'Expected profile record for updated profileId');

    if (options.keep) {
      console.log('[student-system-verify] keep=true, leaving test student in DB');
      console.log(`[student-system-verify] keptStudentId=${created.id}`);
      return;
    }

    console.log('[student-system-verify] step=delete');
    const removed = await deleteStudentProfile(created.id, { config });
    assertOrThrow(removed, 'Expected delete to return true');

    console.log('[student-system-verify] step=get-after-delete');
    const afterDelete = await getStudentProfileById(created.id, { config });
    assertOrThrow(afterDelete === null, 'Expected deleted student to be missing');

    console.log('[student-system-verify] step=binding-after-delete');
    const bindingAfterDelete = await getActiveStudentProfileBinding(created.id);
    assertOrThrow(bindingAfterDelete === null, 'Expected no active binding after delete');

    console.log('[student-system-verify] PASS');
  } catch (error) {
    if (!options.keep && createdStudentId) {
      try {
        await deleteStudentProfile(createdStudentId, { config });
      } catch {
        // Best-effort cleanup only.
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[student-system-verify] FAIL: ${message}`);
    process.exitCode = 1;
  }
}

void run();

import path from 'node:path';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { upsertProfile } from '../domain/profile-repository.js';
import { upsertStudent } from '../domain/student-repository.js';
import {
  clearActiveStudentProfileBinding,
  setActiveStudentProfileBinding,
} from '../domain/student-profile-binding-repository.js';
import { listStudentProfiles } from '../application/student-profiles-store.js';

interface CliOptions {
  dryRun: boolean;
  studentsDir?: string;
}

interface BackfillStats {
  studentsUpserted: number;
  profilesUpserted: number;
  bindingsSet: number;
  bindingsCleared: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--students-dir') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --students-dir');
      }
      options.studentsDir = path.resolve(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function toFsConfig(config: BatchBackendConfig): BatchBackendConfig {
  return {
    ...config,
    studentSystem: {
      source: 'fs',
      fsFallback: true,
    },
  };
}

function profileLabelFromId(profileId: string): string {
  const base = path.basename(profileId, path.extname(profileId));
  const normalized = base.replaceAll(/[_-]+/g, ' ').trim();
  return normalized.length > 0 ? normalized : profileId;
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  if (config.orchestrator.configProvider === 'http') {
    throw new Error('Backfill requires local config provider (ESL_PIPELINE_CONFIG_PROVIDER=local)');
  }

  if (!options.dryRun && !config.pg.enabled) {
    throw new Error('Backfill requires Postgres (PG_ENABLED=true)');
  }

  const sourceProfiles = await listStudentProfiles(
    {
      limit: 500,
      offset: 0,
      order: 'asc',
    },
    {
      config: toFsConfig(config),
      studentsDir: options.studentsDir,
    },
  );

  const stats: BackfillStats = {
    studentsUpserted: 0,
    profilesUpserted: 0,
    bindingsSet: 0,
    bindingsCleared: 0,
  };

  for (const profile of sourceProfiles.items) {
    const studentId = profile.id;
    if (!studentId) continue;

    if (!options.dryRun) {
      await upsertStudent({
        id: studentId,
        student: profile.student,
        dbId: profile.dbId ?? null,
        pageParentId: profile.pageParentId ?? null,
        colorPreset: profile.colorPreset ?? null,
        accentPreference: profile.accentPreference ?? null,
        manifestPreset: profile.manifestPreset ?? null,
        profileId: profile.profileId ?? null,
        voices: profile.voices ?? {},
      });
    }
    stats.studentsUpserted += 1;

    if (profile.profileId) {
      if (!options.dryRun) {
        await upsertProfile({
          id: profile.profileId,
          label: profileLabelFromId(profile.profileId),
          activeRevisionId: null,
        });
        await setActiveStudentProfileBinding({
          studentId,
          profileId: profile.profileId,
          reason: 'phase_a_backfill',
          changedBy: null,
        });
      }
      stats.profilesUpserted += 1;
      stats.bindingsSet += 1;
      continue;
    }

    if (!options.dryRun) {
      await clearActiveStudentProfileBinding(studentId);
    }
    stats.bindingsCleared += 1;
  }

  const mode = options.dryRun ? 'DRY RUN' : 'APPLY';
  console.log(`[student-system-backfill] mode=${mode}`);
  console.log(`[student-system-backfill] students=${sourceProfiles.items.length}`);
  console.log(`[student-system-backfill] studentsUpserted=${stats.studentsUpserted}`);
  console.log(`[student-system-backfill] profilesUpserted=${stats.profilesUpserted}`);
  console.log(`[student-system-backfill] bindingsSet=${stats.bindingsSet}`);
  console.log(`[student-system-backfill] bindingsCleared=${stats.bindingsCleared}`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[student-system-backfill] failed: ${message}`);
  process.exitCode = 1;
});

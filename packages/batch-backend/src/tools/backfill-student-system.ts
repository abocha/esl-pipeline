import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveConfigPaths } from '@esl-pipeline/orchestrator';

import { loadBatchBackendEnv } from '../bootstrap/env.js';
import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { upsertProfile } from '../domain/profile-repository.js';
import {
  clearActiveStudentProfileBinding,
  setActiveStudentProfileBinding,
} from '../domain/student-profile-binding-repository.js';
import { upsertStudent } from '../domain/student-repository.js';
import { deriveStudentId, normalizeStudentName } from '../domain/student-utils.js';

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

interface LegacyStudentProfile {
  id: string;
  student: string;
  dbId: string | null;
  pageParentId: string | null;
  colorPreset: string | null;
  voices: Record<string, string>;
  manifestPreset: string | null;
  accentPreference: string | null;
  profileId: string | null;
}

const DEFAULT_STUDENT_NAME = 'Default';
const DEFAULT_COLOR_PRESET = 'b1-default';

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === '--') {
      continue;
    }

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

function profileLabelFromId(profileId: string): string {
  const base = path.basename(profileId, path.extname(profileId));
  const normalized = base.replaceAll(/[_-]+/g, ' ').trim();
  return normalized.length > 0 ? normalized : profileId;
}

function normalizeOptionalString(value?: string | null): string | null {
  if (typeof value !== 'string') return value ?? null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeVoices(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, token]) => typeof token === 'string' && token.trim().length > 0,
  );
  return Object.fromEntries(entries) as Record<string, string>;
}

function buildDefaultLegacyProfile(): LegacyStudentProfile {
  return {
    id: deriveStudentId(DEFAULT_STUDENT_NAME),
    student: DEFAULT_STUDENT_NAME,
    dbId: null,
    pageParentId: null,
    colorPreset: DEFAULT_COLOR_PRESET,
    voices: {},
    manifestPreset: null,
    accentPreference: null,
    profileId: null,
  };
}

function resolveLegacyStudentsDir(config: BatchBackendConfig, explicitDir?: string): string {
  if (explicitDir) {
    return path.resolve(explicitDir);
  }

  const cwd = process.env.PIPELINE_CWD || process.cwd();
  const configPaths = resolveConfigPaths({
    cwd,
    configDir: config.orchestrator.configDir,
  });

  return configPaths.studentsDir;
}

async function loadLegacyProfiles(studentsDir: string): Promise<LegacyStudentProfile[]> {
  const map = new Map<string, LegacyStudentProfile>();

  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(studentsDir, { withFileTypes: true });
  } catch {
    // Missing directory is treated as empty; default profile still gets seeded.
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.json')) continue;

    const filePath = path.join(studentsDir, entry.name);
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    } catch {
      continue;
    }

    if (!raw || typeof raw !== 'object') continue;
    const json = raw as Record<string, unknown>;
    const student = typeof json.student === 'string' ? normalizeStudentName(json.student) : '';
    if (!student) continue;

    const id = deriveStudentId(student);
    if (map.has(id)) continue;

    map.set(id, {
      id,
      student,
      dbId: normalizeOptionalString(json.dbId as string | null | undefined),
      pageParentId: normalizeOptionalString(json.pageParentId as string | null | undefined),
      colorPreset: normalizeOptionalString(json.colorPreset as string | null | undefined),
      voices: normalizeVoices(json.voices),
      manifestPreset: normalizeOptionalString(json.manifestPreset as string | null | undefined),
      accentPreference: normalizeOptionalString(json.accentPreference as string | null | undefined),
      profileId: normalizeOptionalString(json.profileId as string | null | undefined),
    });
  }

  const defaultId = deriveStudentId(DEFAULT_STUDENT_NAME);
  if (!map.has(defaultId)) {
    map.set(defaultId, buildDefaultLegacyProfile());
  }

  return [...map.values()].sort((a, b) => a.student.localeCompare(b.student));
}

async function run(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-backfill-student-system');
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  if (!options.dryRun && !config.pg.enabled) {
    throw new Error('Backfill requires Postgres (PG_ENABLED=true)');
  }

  const studentsDir = resolveLegacyStudentsDir(config, options.studentsDir);
  const sourceProfiles = await loadLegacyProfiles(studentsDir);

  const stats: BackfillStats = {
    studentsUpserted: 0,
    profilesUpserted: 0,
    bindingsSet: 0,
    bindingsCleared: 0,
  };

  for (const profile of sourceProfiles) {
    const studentId = profile.id;
    if (!studentId) continue;

    if (!options.dryRun) {
      await upsertStudent({
        id: studentId,
        student: profile.student,
        dbId: profile.dbId,
        pageParentId: profile.pageParentId,
        colorPreset: profile.colorPreset,
        accentPreference: profile.accentPreference,
        manifestPreset: profile.manifestPreset,
        profileId: profile.profileId,
        voices: profile.voices,
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
  console.log(`[student-system-backfill] studentsDir=${studentsDir}`);
  console.log(`[student-system-backfill] students=${sourceProfiles.length}`);
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

import { normalizeLegacyStudentProfile } from '../application/legacy-profile-normalization.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { loadConfig } from '../config/env.js';

interface CliOptions {
  studentId: string;
  changedBy: string | null;
  note: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  let studentId: string | null = null;
  let changedBy: string | null = null;
  let note: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || arg === '--') continue;

    if (arg === '--student-id') {
      studentId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--changed-by') {
      changedBy = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--note') {
      note = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!studentId?.trim()) {
    throw new Error('Missing required argument: --student-id <studentId>');
  }

  return {
    studentId: studentId.trim(),
    changedBy: changedBy?.trim() || null,
    note: note?.trim() || null,
  };
}

async function run(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-normalize-legacy-profile');
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  if (!config.pg.enabled) {
    throw new Error('Legacy profile normalization requires Postgres (PG_ENABLED=true)');
  }

  const result = await normalizeLegacyStudentProfile({
    request: {
      studentId: options.studentId,
      reviewerId: options.changedBy,
      reviewerNote: options.note,
    },
    overrides: {
      config,
    },
  });

  console.log(`[legacy-profile-normalization] studentId=${result.studentId}`);
  console.log(`[legacy-profile-normalization] profileId=${result.profileId}`);
  console.log(`[legacy-profile-normalization] sourceRevisionId=${result.sourceRevisionId}`);
  console.log(`[legacy-profile-normalization] snapshotId=${result.snapshotId ?? 'none'}`);
  console.log(
    `[legacy-profile-normalization] lessonMemoryIds=${result.lessonMemoryIds.join(',') || 'none'}`,
  );
  console.log(
    `[legacy-profile-normalization] homeworkMemoryIds=${result.homeworkMemoryIds.join(',') || 'none'}`,
  );
  console.log(`[legacy-profile-normalization] draftRevisionId=${result.draftRevision.id}`);
  console.log(`[legacy-profile-normalization] provider=${result.provider}`);
  console.log(`[legacy-profile-normalization] model=${result.model}`);
  console.log('[legacy-profile-normalization] PASS');
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[legacy-profile-normalization] FAIL: ${message}`);
  process.exitCode = 1;
});

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { configureHostRunPgRuntimeEnv } from '../bootstrap/pg-host-run-env.js';
import { loadConfig } from '../config/env.js';
import { closePgPool } from '../infrastructure/db.js';
import {
  createLegacyProfileMigrationReport,
  migrateLegacyProfiles,
  renderLegacyProfileMigrationItemMarkdown,
  renderLegacyProfileMigrationSummaryMarkdown,
} from '../application/legacy-profile-migration.js';

interface CliOptions {
  apply: boolean;
  changedBy: string | null;
  limit: number | null;
  profileId: string | null;
  reportDir: string | null;
  status: 'draft' | 'active';
}

function parseArgs(argv: string[]): CliOptions {
  let apply = false;
  let changedBy: string | null = null;
  let limit: number | null = null;
  let profileId: string | null = null;
  let reportDir: string | null = null;
  let status: 'draft' | 'active' = 'draft';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || arg === '--') continue;

    if (arg === '--apply') {
      apply = true;
      continue;
    }

    if (arg === '--changed-by') {
      changedBy = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--limit') {
      const raw = argv[index + 1] ?? '';
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Expected --limit to be a positive integer');
      }
      limit = parsed;
      index += 1;
      continue;
    }

    if (arg === '--profile-id') {
      profileId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === '--status') {
      const value = (argv[index + 1] ?? '').trim().toLowerCase();
      if (value !== 'draft' && value !== 'active') {
        throw new Error('Expected --status to be one of: draft, active');
      }
      status = value;
      index += 1;
      continue;
    }

    if (arg === '--report-dir') {
      reportDir = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    apply,
    changedBy: changedBy?.trim() || null,
    limit,
    profileId: profileId?.trim() || null,
    reportDir: reportDir?.trim() || null,
    status,
  };
}

function createTimestampSuffix(now = new Date()): string {
  return now.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function slugifyProfileId(profileId: string): string {
  return profileId.replaceAll(/[^a-zA-Z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '').toLowerCase();
}

async function writeMigrationReportFiles(args: {
  reportDir: string;
  report: ReturnType<typeof createLegacyProfileMigrationReport>;
}): Promise<void> {
  const profilesDir = path.join(args.reportDir, 'profiles');
  await mkdir(profilesDir, { recursive: true });

  await writeFile(
    path.join(args.reportDir, 'summary.json'),
    `${JSON.stringify(args.report, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(args.reportDir, 'summary.md'),
    renderLegacyProfileMigrationSummaryMarkdown(args.report),
    'utf8',
  );

  for (const item of args.report.items) {
    const baseName = slugifyProfileId(item.profileId) || 'profile';
    await writeFile(
      path.join(profilesDir, `${baseName}.json`),
      `${JSON.stringify(item, null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      path.join(profilesDir, `${baseName}.md`),
      renderLegacyProfileMigrationItemMarkdown(item),
      'utf8',
    );
  }
}

async function run(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-migrate-legacy-profiles');
  configureHostRunPgRuntimeEnv();
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  if (!config.pg.enabled) {
    throw new Error('Legacy profile migration requires Postgres (PG_ENABLED=true)');
  }

  const result = await migrateLegacyProfiles({
    request: {
      apply: options.apply,
      reviewerId: options.changedBy,
      limit: options.limit ?? undefined,
      profileId: options.profileId,
      status: options.status,
    },
    overrides: {
      config,
    },
  });
  const report = createLegacyProfileMigrationReport({
    request: {
      apply: options.apply,
      reviewerId: options.changedBy,
      limit: options.limit ?? undefined,
      profileId: options.profileId,
      status: options.status,
    },
    result,
  });
  const reportDir =
    options.reportDir && options.reportDir.length > 0
      ? path.resolve(process.cwd(), options.reportDir)
      : path.resolve(
          process.cwd(),
          'tmp',
          'legacy-profile-migration',
          createTimestampSuffix(new Date(report.metadata.generatedAt)),
        );
  await writeMigrationReportFiles({
    reportDir,
    report,
  });

  console.log(
    `[legacy-profile-migration] mode=${options.apply ? `apply:${options.status}` : 'dry-run'}`,
  );
  console.log(`[legacy-profile-migration] reportDir=${reportDir}`);
  console.log(`[legacy-profile-migration] profilesScanned=${result.profilesScanned}`);
  console.log(`[legacy-profile-migration] planned=${result.plannedCount}`);
  console.log(`[legacy-profile-migration] migrated=${result.migratedCount}`);
  console.log(`[legacy-profile-migration] skipped=${result.skippedCount}`);

  for (const item of result.items) {
    console.log(
      [
        '[legacy-profile-migration:item]',
        `profileId=${item.profileId}`,
        `action=${item.action}`,
        `sourceRevisionId=${item.sourceRevisionId ?? 'none'}`,
        `reason=${item.reason ?? 'none'}`,
        `migratedRevisionId=${item.migratedRevision?.id ?? 'none'}`,
      ].join(' '),
    );
  }

  console.log('[legacy-profile-migration] PASS');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void run()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[legacy-profile-migration] FAIL: ${message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePgPool();
    });
}

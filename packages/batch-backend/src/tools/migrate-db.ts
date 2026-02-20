import { fileURLToPath } from 'node:url';

import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { closePgPool } from '../infrastructure/db.js';
import { verifyMigrations } from '../infrastructure/migration-verify.js';
import { getMigrationStatus, runMigrations } from '../infrastructure/migrations.js';
import { runRlsReadinessAudit } from '../infrastructure/rls-readiness-audit.js';

function printUsage(): void {
  console.log('Usage: tsx src/tools/migrate-db.ts <migrate|status|verify|rls-audit>');
}

async function handleStatus(): Promise<void> {
  const status = await getMigrationStatus();

  console.log(`Migrations directory: ${status.migrationsDir}`);
  console.log(`Discovered migrations: ${status.discovered.length}`);
  console.log(`Applied migrations: ${status.applied.length}`);
  console.log(`Pending migrations: ${status.pending.length}`);

  if (status.pending.length > 0) {
    console.log('Pending:');
    for (const migration of status.pending) {
      console.log(`  - ${migration.id}`);
    }
  }

  if (status.checksumMismatches.length > 0) {
    console.log('Checksum mismatches:');
    for (const mismatch of status.checksumMismatches) {
      console.log(
        `  - ${mismatch.id}: db=${mismatch.actual.slice(0, 16)} file=${mismatch.expected.slice(0, 16)}`,
      );
    }
  }

  if (status.missingFilesForApplied.length > 0) {
    console.log('Applied migrations missing on disk:');
    for (const id of status.missingFilesForApplied) {
      console.log(`  - ${id}`);
    }
  }

  if (status.checksumMismatches.length > 0 || status.missingFilesForApplied.length > 0) {
    process.exitCode = 1;
  }
}

async function handleMigrate(): Promise<void> {
  await runMigrations();
  await handleStatus();
}

async function handleVerify(): Promise<void> {
  const result = await verifyMigrations();
  if (result.ok) {
    console.log('Migration verification passed.');
    return;
  }

  console.log('Migration verification failed:');
  for (const error of result.errors) {
    console.log(`  - ${error}`);
  }
  process.exitCode = 1;
}

async function handleRlsAudit(): Promise<void> {
  const result = await runRlsReadinessAudit();
  if (result.ok) {
    console.log('RLS readiness audit passed.');
  } else {
    console.log('RLS readiness audit failed:');
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
    process.exitCode = 1;
  }

  if (result.warnings.length > 0) {
    console.log('RLS readiness warnings:');
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`);
    }
  }
}

async function main(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-migrate-db-tool');

  const command = process.argv[2]?.trim().toLowerCase();
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  switch (command) {
    case 'migrate': {
      await handleMigrate();
      break;
    }
    case 'status': {
      await handleStatus();
      break;
    }
    case 'verify': {
      await handleVerify();
      break;
    }
    case 'rls-audit': {
      await handleRlsAudit();
      break;
    }
    default: {
      printUsage();
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePgPool();
    });
}

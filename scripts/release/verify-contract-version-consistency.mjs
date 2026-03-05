#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const semverRe = /^(\d+)\.(\d+)\.(\d+)$/;
const contractVersionsPath = path.join(repoRoot, 'packages/contracts/src/contract-versions.ts');
const migrationsDir = path.join(repoRoot, 'packages/batch-backend/migrations');

function die(message) {
  console.error(`[verify-contract-version-consistency] error: ${message}`);
  process.exit(1);
}

function readConstString(source, constName) {
  const re = new RegExp(`export\\s+const\\s+${constName}\\s*=\\s*'([^']+)'`);
  const match = source.match(re);
  return match ? match[1] : null;
}

function assertSemver(name, value) {
  if (!value || !semverRe.test(value)) {
    die(`${name} must be valid semver (X.Y.Z); found ${value ?? 'missing'}`);
  }
}

function main() {
  const source = readFileSync(contractVersionsPath, 'utf8');

  const api = readConstString(source, 'API_CONTRACT_VERSION');
  const manifest = readConstString(source, 'MANIFEST_CONTRACT_VERSION');
  const prompt = readConstString(source, 'PROMPT_SCHEMA_VERSION');
  const validator = readConstString(source, 'VALIDATOR_CONTRACT_VERSION');
  const db = readConstString(source, 'DB_CONTRACT_VERSION');
  const dbMigrationHead = readConstString(source, 'DB_MIGRATION_HEAD');

  assertSemver('API_CONTRACT_VERSION', api);
  assertSemver('MANIFEST_CONTRACT_VERSION', manifest);
  assertSemver('PROMPT_SCHEMA_VERSION', prompt);
  assertSemver('VALIDATOR_CONTRACT_VERSION', validator);
  assertSemver('DB_CONTRACT_VERSION', db);

  if (!dbMigrationHead) {
    die('DB_MIGRATION_HEAD must be defined in contract-versions.ts');
  }

  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b));

  if (migrationFiles.length === 0) {
    die('No migration files found in packages/batch-backend/migrations');
  }

  const latestMigration = migrationFiles[migrationFiles.length - 1].replace(/\.sql$/, '');
  if (dbMigrationHead !== latestMigration) {
    die(`DB_MIGRATION_HEAD (${dbMigrationHead}) must match latest migration (${latestMigration})`);
  }

  console.log('[verify-contract-version-consistency] OK');
  console.log(`- latest migration: ${latestMigration}`);
  console.log(`- api: ${api}`);
  console.log(`- manifest: ${manifest}`);
  console.log(`- prompt: ${prompt}`);
  console.log(`- validator: ${validator}`);
  console.log(`- db: ${db}`);
}

main();

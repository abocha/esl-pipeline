#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { migrationInventory, validateCompatibility } from '../deploy/schema-compatibility.mjs';

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

  assertSemver('API_CONTRACT_VERSION', api);
  assertSemver('MANIFEST_CONTRACT_VERSION', manifest);
  assertSemver('PROMPT_SCHEMA_VERSION', prompt);
  assertSemver('VALIDATOR_CONTRACT_VERSION', validator);
  assertSemver('DB_CONTRACT_VERSION', db);

  const sqlFiles = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name);
  const invalidFiles = sqlFiles.filter((file) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(file));
  if (invalidFiles.length > 0) {
    die(`Invalid backend migration filenames: ${invalidFiles.join(', ')}`);
  }
  const migrationFiles = sqlFiles.sort((a, b) => a.localeCompare(b));

  if (migrationFiles.length === 0) {
    die('No migration files found in packages/batch-backend/migrations');
  }

  const latestMigration = migrationFiles[migrationFiles.length - 1].replace(/\.sql$/, '');
  validateCompatibility(migrationInventory(migrationsDir));
  console.log('[verify-contract-version-consistency] OK');
  console.log(`- latest migration: ${latestMigration}`);
  console.log(`- api: ${api}`);
  console.log(`- manifest: ${manifest}`);
  console.log(`- prompt: ${prompt}`);
  console.log(`- validator: ${validator}`);
  console.log(`- db: ${db}`);
}

main();

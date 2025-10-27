#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runImport } from '../src/index.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadEnv();
const repoEnvPath = resolve(moduleDir, '../../../.env');
if (existsSync(repoEnvPath)) {
  loadEnv({ path: repoEnvPath, override: false });
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

(async () => {
  const md = arg('--md');
  const dbId = arg('--db-id');
  const dbName = arg('--db');
  const dataSourceId = arg('--data-source-id');
  const dataSourceName = arg('--data-source');
  const student = arg('--student');
  const dryRun = process.argv.includes('--dry-run');

  if (!md) {
    console.error(
      'Usage: notion-importer --md <file.md> [--data-source-id <id> | (--db-id <id> | --db "Homework Assignments") [--data-source <name>]] [--student "Name"] [--dry-run]'
    );
    process.exit(1);
  }

  if (!dataSourceId && !dbId && !dbName) {
    console.error(
      'Provide --data-source-id or --db-id/--db (optionally with --data-source <name>) to resolve a data source.'
    );
    process.exit(1);
  }

  try {
    const res = await runImport({
      mdPath: md,
      dbId,
      dbName,
      dataSourceId,
      dataSourceName,
      student,
      dryRun,
    });
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
})();

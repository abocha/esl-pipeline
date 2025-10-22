#!/usr/bin/env node
import { runImport } from '../src/index.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

(async () => {
  const md = arg('--md');
  const dbId = arg('--db-id');
  const dbName = arg('--db');
  const student = arg('--student');
  const dryRun = process.argv.includes('--dry-run');

  if (!md || (!dbId && !dbName)) {
    console.error('Usage: notion-importer --md <file.md> (--db-id <id> | --db "Homework Assignments") [--student "Name"] [--dry-run]');
    process.exit(1);
  }

  try {
    const res = await runImport({ mdPath: md, dbId, dbName, student, dryRun });
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
})();

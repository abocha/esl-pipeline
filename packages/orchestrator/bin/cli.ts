#!/usr/bin/env node
import { newAssignment } from '../src/index.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const md = flag('--md');
if (!md) {
  console.error('Usage: esl-orchestrator --md <file.md> [--student "Name"] [--preset default] [--with-tts] [--upload s3] [--dry-run]');
  process.exit(1);
}

const result = await newAssignment({
  md,
  student: flag('--student'),
  preset: flag('--preset'),
  presetsPath: flag('--presets-path'),
  withTts: args.includes('--with-tts'),
  upload: flag('--upload') as 's3' | undefined,
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
  voices: flag('--voices'),
  out: flag('--out'),
  dbId: flag('--db-id'),
  db: flag('--db'),
  dataSourceId: flag('--data-source-id'),
  dataSource: flag('--data-source')
});

console.log(JSON.stringify(result, null, 2));

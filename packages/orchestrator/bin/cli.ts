#!/usr/bin/env node
import { getAssignmentStatus, newAssignment, rerunAssignment } from '../src/index.js';
import type { RerunFlags } from '../src/index.js';

type RerunStep = NonNullable<RerunFlags['steps']>[number];

const rawArgs = process.argv.slice(2);

const usage = (): never => {
  console.error(`Usage:
  esl-orchestrator --md <file.md> [options]               # run full pipeline
  esl-orchestrator status --md <file.md>                   # inspect manifest/status
  esl-orchestrator rerun --md <file.md> [--steps tts,upload,add-audio] [options]`);
  process.exit(1);
};

const getFlag = (args: string[], name: string): string | undefined => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const hasFlag = (args: string[], name: string): boolean => args.includes(name);

const command = rawArgs[0] && !rawArgs[0].startsWith('--') ? rawArgs[0] : null;

if (command === 'status') {
  const args = rawArgs.slice(1);
  const mdArg = getFlag(args, '--md');
  if (!mdArg) usage();
  const md = mdArg!;
  const status = await getAssignmentStatus(md);
  console.log(JSON.stringify(status, null, 2));
  process.exit(0);
}

if (command === 'rerun') {
  const args = rawArgs.slice(1);
  const mdArg = getFlag(args, '--md');
  if (!mdArg) usage();
  const md = mdArg!;

  const stepsRaw = getFlag(args, '--steps');

  const presignRaw = getFlag(args, '--presign');
  const presign = presignRaw ? Number.parseInt(presignRaw, 10) : undefined;
  const parsedSteps = stepsRaw
    ? (stepsRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean) as RerunStep[])
    : undefined;

  const result = await rerunAssignment({
    md,
    steps: parsedSteps,
    voices: getFlag(args, '--voices'),
    out: getFlag(args, '--out'),
    force: hasFlag(args, '--force'),
    dryRun: hasFlag(args, '--dry-run'),
    upload: getFlag(args, '--upload') as 's3' | undefined,
    prefix: getFlag(args, '--prefix'),
    publicRead: hasFlag(args, '--public-read'),
    presign: typeof presign === 'number' && !Number.isNaN(presign) ? presign : undefined,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const args = command ? rawArgs.slice(1) : rawArgs;
const mdArg = getFlag(args, '--md');
if (!mdArg) usage();
const md = mdArg!;

const presignRaw = getFlag(args, '--presign');
const presign = presignRaw ? Number.parseInt(presignRaw, 10) : undefined;

const result = await newAssignment({
  md,
  student: getFlag(args, '--student'),
  preset: getFlag(args, '--preset'),
  presetsPath: getFlag(args, '--presets-path'),
  withTts: hasFlag(args, '--with-tts'),
  upload: getFlag(args, '--upload') as 's3' | undefined,
  presign: typeof presign === 'number' && !Number.isNaN(presign) ? presign : undefined,
  publicRead: hasFlag(args, '--public-read'),
  prefix: getFlag(args, '--prefix'),
  dryRun: hasFlag(args, '--dry-run'),
  force: hasFlag(args, '--force'),
  voices: getFlag(args, '--voices'),
  out: getFlag(args, '--out'),
  dbId: getFlag(args, '--db-id'),
  db: getFlag(args, '--db'),
  dataSourceId: getFlag(args, '--data-source-id'),
  dataSource: getFlag(args, '--data-source'),
});

console.log(JSON.stringify(result, null, 2));

#!/usr/bin/env node
import { resolve } from 'node:path';
import process from 'node:process';
import { getAssignmentStatus, newAssignment, rerunAssignment } from '../src/index.js';
import type { NewAssignmentFlags, RerunFlags } from '../src/index.js';
import { createLogger } from '../src/logger.js';
import { runInteractiveWizard, WizardAbortedError } from '../src/wizard.js';

type RerunStep = NonNullable<RerunFlags['steps']>[number];

const rawArgs = process.argv.slice(2);

const getFlag = (args: string[], name: string): string | undefined => {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1] && !args[idx + 1]!.startsWith('--') ? args[idx + 1] : undefined;
};

const hasFlag = (args: string[], name: string): boolean => args.includes(name);

const usage = (): never => {
  console.error(`Usage:
  esl-orchestrator --md <file.md> [options]                        
      --interactive             Launch guided wizard for missing flags
      --with-tts                Generate ElevenLabs audio
      --upload s3               Upload audio to S3 (requires --with-tts)
      --skip-import             Reuse existing Notion page from manifest
      --skip-tts                Reuse existing audio from manifest
      --skip-upload             Skip uploading (keeps manifest audio URL)
      --redo-tts                Force regenerate audio even if cached
      --json                    Emit structured JSON log output

  esl-orchestrator status --md <file.md> [--json]                  
  esl-orchestrator rerun --md <file.md> [--steps tts,upload,add-audio] [options]`);
  process.exit(1);
};

type RunFlags = {
  md?: string;
  student?: string;
  preset?: string;
  presetsPath?: string;
  withTts: boolean;
  upload?: 's3';
  presign?: number;
  publicRead: boolean;
  prefix?: string;
  dryRun: boolean;
  force: boolean;
  voices?: string;
  out?: string;
  dbId?: string;
  db?: string;
  dataSourceId?: string;
  dataSource?: string;
  skipImport: boolean;
  skipTts: boolean;
  skipUpload: boolean;
  redoTts: boolean;
  interactive: boolean;
};

const parseNumber = (value?: string): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseRunFlags = (args: string[]): RunFlags => ({
  md: getFlag(args, '--md'),
  student: getFlag(args, '--student'),
  preset: getFlag(args, '--preset'),
  presetsPath: getFlag(args, '--presets-path'),
  withTts: hasFlag(args, '--with-tts'),
  upload: (getFlag(args, '--upload') as 's3' | undefined) ?? undefined,
  presign: parseNumber(getFlag(args, '--presign')),
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
  skipImport: hasFlag(args, '--skip-import'),
  skipTts: hasFlag(args, '--skip-tts'),
  skipUpload: hasFlag(args, '--skip-upload'),
  redoTts: hasFlag(args, '--redo-tts'),
  interactive: hasFlag(args, '--interactive'),
});

const command = rawArgs[0] && !rawArgs[0].startsWith('--') ? rawArgs[0] : null;
const jsonOutput = hasFlag(rawArgs, '--json');
const logger = createLogger({ json: jsonOutput });

const outputRunSummary = (
  result: Awaited<ReturnType<typeof newAssignment>>,
  flags: RunFlags
): void => {
  if (jsonOutput) return;
  console.log('\nSummary');
  console.log(`  Markdown : ${flags.md}`);
  if (flags.student) console.log(`  Student  : ${flags.student}`);
  if (flags.preset) console.log(`  Preset   : ${flags.preset}`);
  console.log(`  Steps    : ${result.steps.join(', ')}`);
  if (result.manifestPath) console.log(`  Manifest : ${resolve(result.manifestPath)}`);
  if (result.pageUrl) console.log(`  Page URL : ${result.pageUrl}`);
  if (result.audio?.url) console.log(`  Audio URL: ${result.audio.url}`);
  else if (result.audio?.path) console.log(`  Audio    : ${result.audio.path}`);
};

const outputStatusSummary = (
  status: Awaited<ReturnType<typeof getAssignmentStatus>>,
  md: string
): void => {
  if (jsonOutput) return;
  console.log(`Status for ${md}`);
  console.log(`  Manifest : ${status.manifestPath}`);
  console.log(`  Exists   : ${status.manifest ? 'yes' : 'no'}`);
  console.log(`  MD hash  : ${status.mdHashMatches ? 'matches' : 'differs'}`);
  console.log(`  Audio    : ${status.audioFileExists ? 'present' : 'missing'}`);
  if (status.manifest?.pageUrl) console.log(`  Page URL : ${status.manifest.pageUrl}`);
  if (status.manifest?.audio?.url) console.log(`  Audio URL: ${status.manifest.audio.url}`);
};

async function handleStatus(args: string[]): Promise<void> {
  const mdArg = getFlag(args, '--md');
  if (!mdArg) usage();
  const md = mdArg!;
  logger.info('Loading assignment status', { md });
  const status = await getAssignmentStatus(md);
  logger.success('Status loaded', { manifestPath: status.manifestPath });
  outputStatusSummary(status, md);
  logger.flush({ command: 'status', status });
}

async function handleRerun(args: string[]): Promise<void> {
  const mdArg = getFlag(args, '--md');
  if (!mdArg) usage();
  const md = mdArg!;
  const stepsRaw = getFlag(args, '--steps');
  const steps = stepsRaw
    ? (stepsRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean) as RerunStep[])
    : undefined;

  const rerunFlags: RerunFlags = {
    md,
    steps,
    voices: getFlag(args, '--voices'),
    out: getFlag(args, '--out'),
    force: hasFlag(args, '--force'),
    dryRun: hasFlag(args, '--dry-run'),
    upload: (getFlag(args, '--upload') as 's3' | undefined) ?? undefined,
    prefix: getFlag(args, '--prefix'),
    publicRead: hasFlag(args, '--public-read'),
    presign: parseNumber(getFlag(args, '--presign')),
  };

  logger.info('Rerunning pipeline steps', {
    md,
    steps: steps ?? ['upload', 'add-audio'],
  });

  const result = await rerunAssignment(rerunFlags);
  logger.success('Rerun completed', { steps: result.steps });

  if (!jsonOutput) {
    console.log('\nRerun Summary');
    console.log(`  Markdown : ${md}`);
    console.log(`  Steps    : ${result.steps.join(', ')}`);
    console.log(`  Manifest : ${resolve(result.manifestPath)}`);
    if (result.audio?.url) console.log(`  Audio URL: ${result.audio.url}`);
  }

  logger.flush({ command: 'rerun', result });
}

async function handleRun(args: string[]): Promise<void> {
  const parsed = parseRunFlags(args);
  if (!parsed.md && !parsed.interactive) usage();
  const md = parsed.md;

  let flagsForRun = { ...parsed };

  if (parsed.interactive) {
    try {
      const wizardFlags = await runInteractiveWizard(
        {
          md: parsed.md,
          student: parsed.student,
          preset: parsed.preset,
          presetsPath: parsed.presetsPath,
          withTts: parsed.withTts,
          upload: parsed.upload,
          publicRead: parsed.publicRead,
          prefix: parsed.prefix,
          dryRun: parsed.dryRun,
          force: parsed.force,
          voices: parsed.voices,
          out: parsed.out,
          dbId: parsed.dbId,
          db: parsed.db,
          dataSourceId: parsed.dataSourceId,
          dataSource: parsed.dataSource,
        },
        {
          cwd: process.cwd(),
          presetsPath: parsed.presetsPath,
          voicesPath: parsed.voices,
        }
      );
      flagsForRun = {
        ...flagsForRun,
        ...wizardFlags,
      };
    } catch (error) {
      if (error instanceof WizardAbortedError) {
        logger.warn('Interactive wizard cancelled by user');
        logger.flush({ command: 'run', cancelled: true });
        process.exit(1);
      }
      throw error;
    }
  }

  if (!flagsForRun.md) usage();

  const runFlags = {
    ...flagsForRun,
    md: flagsForRun.md,
    redoTts: flagsForRun.redoTts,
    skipImport: flagsForRun.skipImport,
    skipTts: flagsForRun.skipTts,
    skipUpload: flagsForRun.skipUpload,
  } as RunFlags & { md: string };

  logger.info('Starting assignment pipeline', {
    md: runFlags.md,
    withTts: runFlags.withTts,
    upload: runFlags.upload ?? 'none',
  });

  const { interactive: _interactive, ...assignmentFlags } = runFlags;

  const result = await newAssignment(assignmentFlags as unknown as NewAssignmentFlags);

  logger.success('Assignment pipeline completed', {
    steps: result.steps,
    manifest: result.manifestPath ? resolve(result.manifestPath) : undefined,
  });
  outputRunSummary(result, runFlags);
  logger.flush({ command: 'run', result });
}

async function main(): Promise<void> {
  try {
    if (command === 'status') {
      await handleStatus(rawArgs.slice(1));
      return;
    }

    if (command === 'rerun') {
      await handleRerun(rawArgs.slice(1));
      return;
    }

    const args = command ? rawArgs.slice(1) : rawArgs;
    await handleRun(args);
  } catch (error: any) {
    const message = error?.message ?? String(error);
    logger.error(message, {
      name: error?.name ?? 'Error',
      stack: error?.stack,
    });
    logger.flush({ command: command ?? 'run', error: { message, name: error?.name } });
    process.exit(1);
  }
}

await main();

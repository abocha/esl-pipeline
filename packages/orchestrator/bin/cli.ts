#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import ora from 'ora';
import {
  getAssignmentStatus,
  newAssignment,
  rerunAssignment,
  summarizeVoiceSelections,
  type AssignmentProgressEvent,
  type AssignmentStage,
} from '../src/index.js';
import type { NewAssignmentFlags, RerunFlags } from '../src/index.js';
import { createLogger } from '../src/logger.js';
import {
  runInteractiveWizard,
  WizardAbortedError,
  type WizardRunResult,
  type WizardSelections,
} from '../src/wizard.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadEnv();
const repoEnvPath = resolve(moduleDir, '../../../.env');
if (existsSync(repoEnvPath)) {
  loadEnv({ path: repoEnvPath, override: false });
}

type RerunStep = NonNullable<RerunFlags['steps']>[number];

const rawArgs = process.argv.slice(2);

const shouldLogPlainSecrets =
  (process.env.ORCHESTRATOR_DEBUG_SECRETS ?? '').toLowerCase() === 'true' ||
  process.env.ORCHESTRATOR_DEBUG_SECRETS === '1';

const maskSecret = (value: string): string => {
  if (value.length <= 4) return '*'.repeat(value.length);
  if (value.length <= 8) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
};

const logNotionToken = (): void => {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    logger.warn('NOTION_TOKEN missing from environment');
    return;
  }
  const details: Record<string, unknown> = {
    length: token.length,
    preview: maskSecret(token),
  };
  if (shouldLogPlainSecrets) {
    details.token = token;
  }
  logger.info('Loaded NOTION_TOKEN from environment', details);
  if (token.length < 40) {
    logger.warn(
      'NOTION_TOKEN looks unusually short – double-check your .env or shell exports. Notion tokens normally start with "secret_" and are ~50 chars.'
    );
  }
};

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
  const voiceSummary = summarizeVoiceSelections(result.audio?.voices);
  if (voiceSummary) console.log(`  Voices   : ${voiceSummary}`);
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

const stageLabels: Record<AssignmentStage, string> = {
  validate: 'Validating markdown',
  import: 'Importing into Notion',
  colorize: 'Applying heading preset',
  tts: 'Generating ElevenLabs audio',
  upload: 'Uploading audio',
  'add-audio': 'Attaching audio in Notion',
  manifest: 'Writing manifest',
};

const formatSuccessText = (event: AssignmentProgressEvent): string => {
  const base = stageLabels[event.stage] ?? event.stage;
  if (event.stage === 'colorize' && event.detail) {
    const preset = event.detail.preset as string | undefined;
    const counts = event.detail.counts as
      | { h2?: number; h3?: number; toggles?: number }
      | undefined;
    if (preset && counts) {
      return `${base} (preset: ${preset}, H2/H3/Toggles: ${counts.h2}/${counts.h3}/${counts.toggles})`;
    }
    if (preset) return `${base} (preset: ${preset})`;
  }
  if (event.stage === 'upload' && event.detail) {
    if (event.detail.dryRun) return `${base} (dry run URL prepared)`;
    if (event.detail.url) return `${base} (${event.detail.url})`;
  }
  if (event.stage === 'add-audio' && event.detail?.dryRun) {
    return `${base} (dry run)`;
  }
  if (event.stage === 'manifest' && event.detail?.manifestPath) {
    return `${base} (${resolve(String(event.detail.manifestPath))})`;
  }
  return base;
};

const formatSkipText = (event: AssignmentProgressEvent): string => {
  const base = stageLabels[event.stage] ?? event.stage;
  const reason = event.detail?.reason as string | undefined;
  return reason ? `${base} (skipped – ${reason})` : `${base} (skipped)`;
};

async function handleRun(args: string[]): Promise<void> {
  const parsed = parseRunFlags(args);
  if (!parsed.md && !parsed.interactive) usage();

  const useFancy = parsed.interactive && !jsonOutput;
  let wizardSelections: WizardSelections | undefined;
  let assignmentFlags: NewAssignmentFlags;

  if (parsed.interactive) {
    try {
      const wizardResult: WizardRunResult = await runInteractiveWizard(
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
      assignmentFlags = wizardResult.flags;
      wizardSelections = wizardResult.selections;
    } catch (error) {
      if (error instanceof WizardAbortedError) {
        logger.warn('Interactive wizard cancelled by user');
        logger.flush({ command: 'run', cancelled: true });
        process.exit(1);
      }
      throw error;
    }
  } else {
    const md = parsed.md ?? usage();
    assignmentFlags = {
      md,
      student: parsed.student ?? undefined,
      preset: parsed.preset ?? undefined,
      presetsPath: parsed.presetsPath ?? undefined,
      withTts: parsed.withTts ? true : undefined,
      upload: parsed.upload,
      presign: parsed.presign ?? undefined,
      publicRead: parsed.publicRead ? true : undefined,
      prefix: parsed.prefix ?? undefined,
      dryRun: parsed.dryRun ? true : undefined,
      force: parsed.force ? true : undefined,
      voices: parsed.voices ?? undefined,
      out: parsed.out ?? undefined,
      dbId: parsed.dbId ?? undefined,
      db: parsed.db ?? undefined,
      dataSourceId: parsed.dataSourceId ?? undefined,
      dataSource: parsed.dataSource ?? undefined,
      skipImport: parsed.skipImport ? true : undefined,
      skipTts: parsed.skipTts ? true : undefined,
      skipUpload: parsed.skipUpload ? true : undefined,
      redoTts: parsed.redoTts ? true : undefined,
    };
  }

  logger.info('Starting assignment pipeline', {
    md: assignmentFlags.md,
    withTts: Boolean(assignmentFlags.withTts),
    upload: assignmentFlags.upload ?? 'none',
  });

  const stageOutcomes: AssignmentProgressEvent[] = [];
  const spinner = useFancy ? ora({ spinner: 'dots', color: 'cyan' }) : null;

  const progressCallbacks = {
    onStage: (event: AssignmentProgressEvent) => {
      if (event.status !== 'start') stageOutcomes.push(event);
      if (!useFancy) return;
      const label = stageLabels[event.stage] ?? event.stage;
      if (event.status === 'start') {
        spinner?.start(label);
        return;
      }
      if (event.status === 'success') {
        const text = formatSuccessText(event);
        if (spinner?.isSpinning) spinner.succeed(text);
        else spinner?.succeed?.(text);
        return;
      }
      if (event.status === 'skipped') {
        const text = formatSkipText(event);
        if (spinner?.isSpinning) spinner.stop();
        spinner?.info(text);
      }
    },
  };

  logNotionToken();
  const result = await newAssignment(assignmentFlags, progressCallbacks);

  if (spinner?.isSpinning) spinner.stop();

  logger.success('Assignment pipeline completed', {
    steps: result.steps,
    manifest: result.manifestPath ? resolve(result.manifestPath) : undefined,
  });

  if (parsed.interactive && !jsonOutput && wizardSelections) {
    printWizardSummary(result, wizardSelections, stageOutcomes);
  } else {
    const summaryFlags: RunFlags = {
      ...parsed,
      md: assignmentFlags.md,
      student: assignmentFlags.student,
      preset: assignmentFlags.preset,
      presetsPath: assignmentFlags.presetsPath,
      withTts: Boolean(assignmentFlags.withTts),
      upload: assignmentFlags.upload,
      presign: assignmentFlags.presign,
      publicRead: Boolean(assignmentFlags.publicRead),
      prefix: assignmentFlags.prefix,
      dryRun: Boolean(assignmentFlags.dryRun),
      force: Boolean(assignmentFlags.force),
      voices: assignmentFlags.voices,
      out: assignmentFlags.out,
      dbId: assignmentFlags.dbId,
      db: assignmentFlags.db,
      dataSourceId: assignmentFlags.dataSourceId,
      dataSource: assignmentFlags.dataSource,
      skipImport: Boolean(assignmentFlags.skipImport),
      skipTts: Boolean(assignmentFlags.skipTts),
      skipUpload: Boolean(assignmentFlags.skipUpload),
      redoTts: Boolean(assignmentFlags.redoTts),
      interactive: parsed.interactive,
    };
    outputRunSummary(result, summaryFlags);
  }

  logger.flush({ command: 'run', result });
}

const printWizardSummary = (
  result: Awaited<ReturnType<typeof newAssignment>>,
  selections: WizardSelections,
  stages: AssignmentProgressEvent[]
): void => {
  console.log('\n✨ Wizard Complete');

  console.log('\nAssignment');
  console.log(`  Markdown : ${selections.md}`);
  if (selections.student) console.log(`  Student  : ${selections.student}`);
  if (selections.dbId) console.log(`  Database : ${selections.dbId}`);
  if (selections.preset) console.log(`  Preset   : ${selections.preset}`);
  console.log(`  Audio    : ${selections.withTts ? 'Enabled' : 'Disabled'}`);
  if (selections.withTts && selections.voices) {
    console.log(`  Voice map: ${selections.voices}`);
  }
  const actualVoices = summarizeVoiceSelections(result.audio?.voices);
  if (actualVoices) console.log(`  Voices   : ${actualVoices}`);
  if (selections.upload === 's3') {
    const prefix = selections.prefix ?? process.env.S3_PREFIX ?? 'audio/assignments';
    console.log(`  Upload   : S3 (${prefix})${selections.publicRead ? ' [public]' : ''}`);
  } else {
    console.log('  Upload   : None');
  }
  console.log(`  Dry run  : ${selections.dryRun ? 'Yes' : 'No'}`);

  const outcomeByStage = new Map<AssignmentStage, AssignmentProgressEvent>();
  for (const event of stages) {
    outcomeByStage.set(event.stage, event);
  }

  const orderedStages: AssignmentStage[] = [
    'validate',
    'import',
    'colorize',
    'tts',
    'upload',
    'add-audio',
    'manifest',
  ];

  console.log('\nProgress');
  for (const stage of orderedStages) {
    const event = outcomeByStage.get(stage);
    if (!event) continue;
    const label = event.status === 'success' ? formatSuccessText(event) : formatSkipText(event);
    const symbol = event.status === 'success' ? '✔' : '↷';
    console.log(`  ${symbol} ${label}`);
  }

  console.log('\nDeliverables');
  if (result.pageUrl) console.log(`  • Notion page: ${result.pageUrl}`);
  if (result.audio?.url) console.log(`  • Audio URL  : ${result.audio.url}`);
  else if (result.audio?.path) console.log(`  • Audio file : ${result.audio.path}`);
  if (result.manifestPath) console.log(`  • Manifest   : ${resolve(result.manifestPath)}`);

  console.log('\nNext Steps');
  console.log('  1. Review the Notion page and confirm formatting.');
  if (result.audio?.url) {
    console.log('  2. Share the audio link with the student.');
  } else if (result.audio?.path) {
    console.log('  2. Send the generated audio file to the student.');
  } else {
    console.log('  2. Run the pipeline with TTS enabled when you are ready to record audio.');
  }
  console.log(
    `  3. Rerun specific stages with: pnpm esl-orchestrator rerun --md "${selections.md}"`
  );
};

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

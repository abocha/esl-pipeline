#!/usr/bin/env node
import { Command, CommanderError, InvalidOptionArgumentError } from 'commander';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ora from 'ora';
import pc from 'picocolors';

import { DEFAULT_STUDENT_NAME, type StudentProfile } from '../src/config.js';
import {
  type AssignmentProgressEvent,
  type AssignmentStage,
  type OrchestratorPipeline,
  type PipelineLogger,
  createPipeline,
  loadEnvFilesWithSummary,
  summarizeVoiceSelections,
} from '../src/index.js';
import type { NewAssignmentFlags, RerunFlags } from '../src/index.js';
import { createLogger } from '../src/logger.js';
import {
  type DirOptions,
  type FileOptions,
  PathPickerCancelledError,
  pickDirectory,
  pickFile,
  resolveDirectoryCandidates,
  resolveFileCandidates,
  resolveSearchRoot,
} from '../src/pathPicker.js';
import {
  WizardAbortedError,
  type WizardRunResult,
  type WizardSelections,
  runInteractiveWizard,
} from '../src/wizard.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoEnvPath = resolve(moduleDir, '../../../.env');
const envFiles = ['.env'];
if (existsSync(repoEnvPath)) {
  envFiles.push(repoEnvPath);
}
const envSummary = loadEnvFilesWithSummary({
  files: envFiles,
  cwd: process.cwd(),
  assignToProcess: true,
  override: false,
});

type RerunStep = NonNullable<RerunFlags['steps']>[number];

const rawArgs = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { version: pkgVersion } = require('../package.json') as { version: string };

if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
  console.log(pkgVersion);
  process.exit(0);
}

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
      'NOTION_TOKEN looks unusually short – double-check your .env or shell exports. Notion tokens normally start with "secret_" and are ~50 chars.',
    );
  }
};

const usage = (): never => {
  console.error(`Usage:
  esl --md <file.md> [options]                        
      --interactive             Launch guided wizard for missing flags
      --with-tts                Generate ElevenLabs audio
      --accent <name>           Preferred voice accent (american, british, etc.)
      --upload s3               Upload audio to S3 (requires --with-tts)
      --skip-import             Reuse existing Notion page from manifest
      --skip-tts                Reuse existing audio from manifest
      --skip-upload             Skip uploading (keeps manifest audio URL)
      --redo-tts                Force regenerate audio even if cached
      --json                    Emit structured JSON log output

  esl status --md <file.md> [--json]                  
  esl rerun --md <file.md> [--steps tts,upload,add-audio] [options]

  esl select [path] [--dir|--file] [picker options]
      --suffix <.d>             (dir) Require directory name to end with suffix
      --contains <f1,f2>        (dir) Require files to exist inside the folder
      --ext <.md,.mp3>          (file) Allowlisted extensions
      --glob <pattern>          (file) Glob pattern(s) to match
      --root <git|cwd|pkg>      Root detection strategy (default git)
      --absolute                Show absolute paths in the prompt/output
      --include-dot             Include dot-prefixed entries
      --limit <n>               Limit visible suggestions
      --verbose                 Print root + relative metadata with result`);
  process.exit(1);
};

interface RunFlags {
  md?: string;
  student?: string;
  preset?: string;
  presetsPath?: string;
  accentPreference?: string;
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
}

const parseOptionalInt = (value: string, label: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new InvalidOptionArgumentError(`${label} must be an integer.`);
  }
  return parsed;
};

const parseOptionalFloat = (value: string, label: string): number => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new InvalidOptionArgumentError(`${label} must be a number.`);
  }
  return parsed;
};

const parseRunFlags = async (args: string[]): Promise<RunFlags> => {
  const program = new Command('run')
    .usage('--md <file.md> [options]')
    .allowExcessArguments(false)
    .option('--md <file>', 'Markdown assignment file')
    .option('--student <name>', 'Student name')
    .option('--preset <name>', 'Color preset name')
    .option('--presets-path <path>', 'Path to presets JSON')
    .option('--accent <name>', 'Preferred voice accent')
    .option('--with-tts', 'Generate ElevenLabs audio')
    .option('--upload <mode>', 'Upload audio to S3', parseUploadOption)
    .option('--presign <seconds>', 'Presign URL expiry in seconds', (value) =>
      parseOptionalInt(value, 'Presign'),
    )
    .option('--public-read', 'Mark uploaded audio as public-read')
    .option('--prefix <path>', 'S3 key prefix')
    .option('--dry-run', 'Skip writes to remote services')
    .option('--force', 'Force overwrite existing artifacts')
    .option('--voices <file>', 'Voice map file (YAML/JSON)')
    .option('--out <dir>', 'Output directory for artifacts')
    .option('--db-id <id>', 'Notion database ID')
    .option('--db <name>', 'Notion database name')
    .option('--data-source-id <id>', 'Notion data source ID')
    .option('--data-source <name>', 'Notion data source name')
    .option('--skip-import', 'Reuse existing Notion page from manifest')
    .option('--skip-tts', 'Reuse existing audio from manifest')
    .option('--skip-upload', 'Skip uploading audio')
    .option('--redo-tts', 'Force regenerate audio even if cached')
    .option('--interactive', 'Launch guided wizard for missing flags');

  const parsed = await parseWithCommander(program, args);
  const opts = parsed.opts<{
    md?: string;
    student?: string;
    preset?: string;
    presetsPath?: string;
    accent?: string;
    withTts?: boolean;
    upload?: 's3';
    presign?: number;
    publicRead?: boolean;
    prefix?: string;
    dryRun?: boolean;
    force?: boolean;
    voices?: string;
    out?: string;
    dbId?: string;
    db?: string;
    dataSourceId?: string;
    dataSource?: string;
    skipImport?: boolean;
    skipTts?: boolean;
    skipUpload?: boolean;
    redoTts?: boolean;
    interactive?: boolean;
  }>();

  return {
    md: opts.md,
    student: opts.student,
    preset: opts.preset,
    presetsPath: opts.presetsPath,
    accentPreference: opts.accent,
    withTts: Boolean(opts.withTts),
    upload: opts.upload,
    presign: opts.presign,
    publicRead: Boolean(opts.publicRead),
    prefix: opts.prefix,
    dryRun: Boolean(opts.dryRun),
    force: Boolean(opts.force),
    voices: opts.voices,
    out: opts.out,
    dbId: opts.dbId,
    db: opts.db,
    dataSourceId: opts.dataSourceId,
    dataSource: opts.dataSource,
    skipImport: Boolean(opts.skipImport),
    skipTts: Boolean(opts.skipTts),
    skipUpload: Boolean(opts.skipUpload),
    redoTts: Boolean(opts.redoTts),
    interactive: Boolean(opts.interactive),
  };
};

const ROOT_CHOICES = ['git', 'cwd', 'pkg'] as const;
type RootChoice = (typeof ROOT_CHOICES)[number];

const collectCsv = (value: string, previous: string[] = []): string[] => {
  const parsed = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return [...new Set([...previous, ...parsed])];
};

const parseLimitOption = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidOptionArgumentError('Limit must be a positive integer.');
  }
  return parsed;
};

const parseUploadOption = (value: string): 's3' => {
  if (value !== 's3') {
    throw new InvalidOptionArgumentError('Upload must be "s3".');
  }
  return 's3';
};

const parseRerunSteps = (value: string): RerunStep[] => {
  const parsed = collectCsv(value) as RerunStep[];
  const allowed: RerunStep[] = ['tts', 'upload', 'add-audio'];
  const invalid = parsed.filter((step) => !allowed.includes(step));
  if (invalid.length > 0) {
    throw new InvalidOptionArgumentError(
      `Unknown steps: ${invalid.join(', ')}. Use one of: ${allowed.join(', ')}`,
    );
  }
  return parsed;
};

const stripGlobalFlags = (args: string[]): string[] => args.filter((arg) => arg !== '--json');

const parseWithCommander = async (program: Command, args: string[]): Promise<Command> => {
  program.exitOverride();
  try {
    return await program.parseAsync(['node', 'cli.js', ...stripGlobalFlags(args)], {
      from: 'node',
    });
  } catch (error) {
    if (error instanceof CommanderError) {
      const message = error.message.trim();
      if (message) console.error(pc.red(message));
      process.exit(error.exitCode);
    }
    throw error;
  }
};

const exitWithError = (message: string): never => {
  console.error(pc.red(message));
  process.exit(1);
};

async function handleSelect(args: string[]): Promise<void> {
  const program = new Command('select')
    .description('Interactively pick a file or directory path with fuzzy filtering.')
    .argument('[path]', 'Validate an existing path instead of launching the picker')
    .option('--dir', 'Restrict selection to directories')
    .option('--file', 'Restrict selection to files (default)')
    .option('--suffix <suffix>', 'When selecting directories, require the name to end with suffix')
    .option(
      '--contains <files...>',
      'When selecting directories, require specific file(s) to exist inside',
      collectCsv,
      [],
    )
    .option(
      '--ext <extensions...>',
      'Comma-separated list of allowed file extensions (e.g. .md,.mp3)',
      collectCsv,
      [],
    )
    .option(
      '--glob <patterns...>',
      'One or more glob patterns to match files (overrides --ext)',
      collectCsv,
      [],
    )
    .option(
      '--root <strategy>',
      'Root detection strategy (git|cwd|pkg)',
      (value) => {
        if (!ROOT_CHOICES.includes(value as RootChoice)) {
          throw new InvalidOptionArgumentError(
            `Unknown root strategy "${value}". Use one of: ${ROOT_CHOICES.join(', ')}`,
          );
        }
        return value as RootChoice;
      },
      'git' satisfies RootChoice,
    )
    .option('--absolute', 'Display absolute paths in the picker', false)
    .option('--limit <n>', 'Visible suggestions limit', parseLimitOption)
    .option('--include-dot', 'Include dot-prefixed files or directories', false)
    .option('--verbose', 'Print additional metadata alongside the selected path', false);

  const parsed = await parseWithCommander(program, args);

  const opts = parsed.opts<{
    dir?: boolean;
    file?: boolean;
    suffix?: string;
    contains: string[];
    ext: string[];
    glob: string[];
    root: RootChoice;
    absolute?: boolean;
    limit?: number;
    includeDot?: boolean;
    verbose?: boolean;
  }>();
  const [pathArg] = parsed.args as string[];

  const wantsDir = Boolean(opts.dir);
  const wantsFile = Boolean(opts.file);
  if (wantsDir && wantsFile) {
    exitWithError('Please use either --dir or --file, not both.');
  }

  const mode: 'dir' | 'file' = wantsDir ? 'dir' : 'file';
  const containsList = [...new Set(opts.contains)];
  const extList = [...new Set(opts.ext)];
  const globList = [...new Set(opts.glob)];

  if (mode === 'dir') {
    if (extList.length > 0) exitWithError('--ext can only be used with --file');
    if (globList.length > 0) exitWithError('--glob can only be used with --file');
  } else {
    if (opts.suffix) exitWithError('--suffix can only be used with --dir');
    if (containsList.length > 0) exitWithError('--contains can only be used with --dir');
  }

  const sharedOptions = {
    cwd: process.cwd(),
    showAbsolute: Boolean(opts.absolute),
    limit: opts.limit,
    rootStrategy: opts.root,
  } as const;

  if (mode === 'dir') {
    const dirOptions: DirOptions = {
      ...sharedOptions,
      mode: containsList.length > 0 ? 'contains' : opts.suffix ? 'suffix' : 'any',
      suffix: opts.suffix,
      contains: containsList,
      includeDotDirs: Boolean(opts.includeDot),
      message: 'Select a directory',
    };
    await runDirectorySelection(dirOptions, pathArg, Boolean(opts.verbose));
    return;
  }

  const fileOptions: FileOptions = {
    ...sharedOptions,
    glob: globList.length > 0 ? globList : undefined,
    extensions: globList.length > 0 ? undefined : extList,
    includeDotFiles: Boolean(opts.includeDot),
    message: 'Select a file',
  };
  await runFileSelection(fileOptions, pathArg, Boolean(opts.verbose));
}

async function runDirectorySelection(
  options: DirOptions,
  providedPath: string | undefined,
  verbose: boolean,
): Promise<void> {
  const lookupOptions = { ...(options as DirOptions) };
  delete (lookupOptions as Partial<DirOptions>).message;

  if (providedPath) {
    const absolute = resolve(process.cwd(), providedPath);
    try {
      const stats = await stat(absolute);
      if (!stats.isDirectory()) {
        exitWithError(`Not a directory: ${absolute}`);
      }
    } catch {
      exitWithError(`Directory not found: ${absolute}`);
    }

    const candidates = await resolveDirectoryCandidates(lookupOptions);
    const match = candidates.find((candidate) => candidate.absolute === absolute);
    if (!match) {
      exitWithError('Provided directory does not satisfy the current filters.');
      return;
    }
    await outputSelection(match.absolute, verbose, lookupOptions);
    return;
  }

  try {
    const selected = await pickDirectory(options);
    await outputSelection(selected, verbose, lookupOptions);
  } catch (error) {
    if (error instanceof PathPickerCancelledError) {
      process.exit(1);
    }
    throw error;
  }
}

async function runFileSelection(
  options: FileOptions,
  providedPath: string | undefined,
  verbose: boolean,
): Promise<void> {
  const lookupOptions = { ...(options as FileOptions) };
  delete (lookupOptions as Partial<FileOptions>).message;

  if (providedPath) {
    const absolute = resolve(process.cwd(), providedPath);
    try {
      const stats = await stat(absolute);
      if (!stats.isFile()) {
        exitWithError(`Not a file: ${absolute}`);
      }
    } catch {
      exitWithError(`File not found: ${absolute}`);
    }

    const candidates = await resolveFileCandidates(lookupOptions);
    const match = candidates.find((candidate) => candidate.absolute === absolute);
    if (!match) {
      exitWithError('Provided file does not satisfy the current filters.');
      return;
    }
    await outputSelection(match.absolute, verbose, lookupOptions);
    return;
  }

  try {
    const selected = await pickFile(options);
    await outputSelection(selected, verbose, lookupOptions);
  } catch (error) {
    if (error instanceof PathPickerCancelledError) {
      process.exit(1);
    }
    throw error;
  }
}

async function outputSelection(
  absolutePath: string,
  verbose: boolean,
  options: { rootStrategy?: RootChoice; cwd?: string },
): Promise<void> {
  if (verbose) {
    const root = await resolveSearchRoot({
      rootStrategy: options.rootStrategy,
      cwd: options.cwd,
    });
    const rel = relative(root, absolutePath);
    console.log(pc.dim(`Root: ${root}`));
    if (rel && !rel.startsWith('..')) {
      console.log(pc.dim(`Relative: ${rel}`));
    } else if (!rel || rel === '.') {
      console.log(pc.dim('Relative: .'));
    } else {
      console.log(pc.dim(`Relative: (outside root) ${rel}`));
    }
  }
  console.log(absolutePath);
}

const command = rawArgs[0] && !rawArgs[0].startsWith('--') ? rawArgs[0] : null;
const jsonOutput = rawArgs.includes('--json');
const logger = createLogger({ json: jsonOutput });

const loadedEnvRelative = envSummary.loadedFiles.map((file) => relative(process.cwd(), file));
const missingEnvRelative = envSummary.missingFiles.map((file) => relative(process.cwd(), file));
logger.info('Environment files processed', {
  loaded: loadedEnvRelative,
  missing: missingEnvRelative,
  assignedKeys: envSummary.assignedKeys.length,
  overriddenKeys: envSummary.overriddenKeys.length,
});

const pipelineLogger: PipelineLogger = {
  log(event) {
    const { level, message, detail, runId, stage } = event;
    const payload: Record<string, unknown> = {};
    if (runId) payload.runId = runId;
    if (stage) payload.stage = stage;
    if (detail && Object.keys(detail).length > 0) payload.detail = detail;

    const isStageEvent = message.startsWith('stage.');
    if (!jsonOutput && isStageEvent) {
      // Spinner/UI already surfaces per-stage status; avoid duplicate console noise.
      return;
    }

    switch (level) {
      case 'error': {
        logger.error(message, payload);
        break;
      }
      case 'warn': {
        logger.warn(message, payload);
        break;
      }
      case 'debug': {
        logger.info(message, payload);
        break;
      }
      default: {
        logger.info(message, payload);
        break;
      }
    }
  },
};

let pipelineInstance: OrchestratorPipeline | null = null;
const ensurePipeline = (): OrchestratorPipeline => {
  if (!pipelineInstance) {
    pipelineInstance = createPipeline({ logger: pipelineLogger });
  }
  return pipelineInstance;
};

let cachedProfiles: { key: string; profiles: StudentProfile[] } | null = null;

const normalizeProfileName = (value?: string): string | undefined =>
  value && value.trim().length > 0 ? value.trim().toLowerCase() : undefined;

const getStudentProfiles = async (pipeline: OrchestratorPipeline): Promise<StudentProfile[]> => {
  const cacheKey = pipeline.configPaths.studentsDir;
  if (cachedProfiles && cachedProfiles.key === cacheKey) return cachedProfiles.profiles;
  const profiles = await pipeline.configProvider.loadStudentProfiles(cacheKey).catch(() => []);
  cachedProfiles = { key: cacheKey, profiles };
  return profiles;
};

const applyProfileDefaults = async (
  pipeline: OrchestratorPipeline,
  flags: NewAssignmentFlags,
): Promise<StudentProfile | undefined> => {
  const profiles = await getStudentProfiles(pipeline);
  if (profiles.length === 0) return undefined;

  const requested = normalizeProfileName(flags.student);
  let profile = requested
    ? profiles.find((p) => normalizeProfileName(p.student) === requested)
    : undefined;

  if (!profile) {
    profile = profiles.find((p) => p.student === DEFAULT_STUDENT_NAME) ?? undefined;
  }

  if (!profile) return undefined;

  if (!flags.dbId && profile.dbId) flags.dbId = profile.dbId ?? undefined;
  if (!flags.preset && profile.colorPreset) flags.preset = profile.colorPreset ?? undefined;
  if (!flags.accentPreference && profile.accentPreference)
    flags.accentPreference = profile.accentPreference ?? undefined;
  return profile;
};

const outputRunSummary = (
  result: Awaited<ReturnType<OrchestratorPipeline['newAssignment']>>,
  flags: RunFlags,
): void => {
  if (jsonOutput) return;
  console.log('\nSummary');
  console.log(`  Markdown : ${flags.md}`);
  if (flags.student) console.log(`  Student  : ${flags.student}`);
  if (flags.preset) console.log(`  Preset   : ${flags.preset}`);
  if (flags.accentPreference) console.log(`  Accent   : ${flags.accentPreference}`);
  console.log(`  Steps    : ${result.steps.join(', ')}`);
  if (result.manifestPath) console.log(`  Manifest : ${resolve(result.manifestPath)}`);
  if (result.pageUrl) console.log(`  Page URL : ${result.pageUrl}`);
  if (result.audio?.url) console.log(`  Audio URL: ${result.audio.url}`);
  else if (result.audio?.path) console.log(`  Audio    : ${result.audio.path}`);
  const voiceSummary = summarizeVoiceSelections(result.audio?.voices);
  if (voiceSummary) console.log(`  Voices   : ${voiceSummary}`);
};

const outputStatusSummary = (
  status: Awaited<ReturnType<OrchestratorPipeline['getAssignmentStatus']>>,
  md: string,
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

const parseStatusFlags = async (args: string[]): Promise<{ md: string }> => {
  const program = new Command('status')
    .usage('--md <file.md>')
    .allowExcessArguments(false)
    .requiredOption('--md <file>', 'Markdown assignment file');

  const parsed = await parseWithCommander(program, args);
  const opts = parsed.opts<{ md: string }>();
  return { md: opts.md };
};

const parseRerunFlags = async (args: string[]): Promise<RerunFlags> => {
  const program = new Command('rerun')
    .usage('--md <file.md> [--steps tts,upload,add-audio] [options]')
    .allowExcessArguments(false)
    .requiredOption('--md <file>', 'Markdown assignment file')
    .option('--steps <steps>', 'Comma-separated steps (tts,upload,add-audio)', parseRerunSteps)
    .option('--voices <file>', 'Voice map file (YAML/JSON)')
    .option('--out <dir>', 'Output directory for artifacts')
    .option('--force', 'Force overwrite existing artifacts')
    .option('--dry-run', 'Skip writes to remote services')
    .option('--upload <mode>', 'Upload audio to S3', parseUploadOption)
    .option('--prefix <path>', 'S3 key prefix')
    .option('--public-read', 'Mark uploaded audio as public-read')
    .option('--presign <seconds>', 'Presign URL expiry in seconds', (value) =>
      parseOptionalInt(value, 'Presign'),
    )
    .option('--accent <name>', 'Preferred voice accent')
    .option('--tts-mode <mode>', 'TTS mode (auto|dialogue|monologue)', (value) => {
      const allowed = ['auto', 'dialogue', 'monologue'] as const;
      if (!allowed.includes(value as (typeof allowed)[number])) {
        throw new InvalidOptionArgumentError(
          `Unknown TTS mode "${value}". Use one of: ${allowed.join(', ')}`,
        );
      }
      return value as RerunFlags['ttsMode'];
    })
    .option(
      '--dialogue-language <code>',
      'Dialogue language code (e.g. en, es) for dialogue TTS mode',
    )
    .option(
      '--dialogue-stability <value>',
      'Dialogue stability (0.0-1.0)',
      (value) => parseOptionalFloat(value, 'Dialogue stability'),
    )
    .option('--dialogue-seed <value>', 'Dialogue seed', (value) =>
      parseOptionalInt(value, 'Dialogue seed'),
    );

  const parsed = await parseWithCommander(program, args);
  const opts = parsed.opts<
    RerunFlags & {
      steps?: RerunStep[];
      accent?: string;
      ttsMode?: RerunFlags['ttsMode'];
      dialogueLanguage?: string;
      dialogueStability?: number;
      dialogueSeed?: number;
    }
  >();

  return {
    md: opts.md,
    steps: opts.steps && opts.steps.length > 0 ? opts.steps : undefined,
    voices: opts.voices,
    out: opts.out,
    force: Boolean(opts.force),
    dryRun: Boolean(opts.dryRun),
    upload: opts.upload,
    prefix: opts.prefix,
    publicRead: Boolean(opts.publicRead),
    presign: opts.presign,
    accentPreference: opts.accent,
    ttsMode: opts.ttsMode,
    dialogueLanguage: opts.dialogueLanguage,
    dialogueStability: opts.dialogueStability,
    dialogueSeed: opts.dialogueSeed,
  };
};

async function handleStatus(args: string[]): Promise<void> {
  const { md } = await parseStatusFlags(args);
  const pipeline = ensurePipeline();
  logger.info('Loading assignment status', { md });
  const status = await pipeline.getAssignmentStatus(md);
  logger.success('Status loaded', { manifestPath: status.manifestPath });
  outputStatusSummary(status, md);
  logger.flush({ command: 'status', status });
}

async function handleRerun(args: string[]): Promise<void> {
  const rerunFlags = await parseRerunFlags(args);
  const { md, steps } = rerunFlags;
  const pipeline = ensurePipeline();

  const appliedFlags: RerunFlags = {
    ...rerunFlags,
    voices: rerunFlags.voices ?? pipeline.defaults.voicesPath,
    out: rerunFlags.out ?? pipeline.defaults.outDir,
  };

  logger.info('Rerunning pipeline steps', {
    md,
    steps: steps ?? ['upload', 'add-audio'],
  });

  const result = await pipeline.rerunAssignment(rerunFlags);
  logger.success('Rerun completed', { steps: result.steps });

  if (!jsonOutput) {
    console.log('\nRerun Summary');
    console.log(`  Markdown : ${md}`);
    console.log(`  Steps    : ${result.steps.join(', ')}`);
    console.log(`  Manifest : ${resolve(result.manifestPath)}`);
    if (result.audio?.url) console.log(`  Audio URL: ${result.audio.url}`);
  }

  const status = await pipeline.getAssignmentStatus(md);
  logger.flush({ command: 'rerun', result, flags: appliedFlags, status });
  if (!jsonOutput) {
    outputStatusSummary(status, md);
  }
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
  const pipeline = ensurePipeline();
  const parsed = await parseRunFlags(args);
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
          presetsPath: parsed.presetsPath ?? pipeline.defaults.presetsPath,
          accentPreference: parsed.accentPreference,
          // IMPORTANT:
          // - For interactive runs, treat absence of --with-tts as "no override".
          // - Only an explicit --with-tts should force true here.
          // - This allows saved wizard.defaults.json withTts to be respected.
          withTts: parsed.withTts ? true : undefined,
          upload: parsed.upload,
          publicRead: parsed.publicRead,
          prefix: parsed.prefix,
          dryRun: parsed.dryRun,
          force: parsed.force,
          voices: parsed.voices ?? pipeline.defaults.voicesPath,
          out: parsed.out ?? pipeline.defaults.outDir,
          dbId: parsed.dbId,
          db: parsed.db,
          dataSourceId: parsed.dataSourceId,
          dataSource: parsed.dataSource,
        },
        {
          cwd: process.cwd(),
          presetsPath: pipeline.defaults.presetsPath,
          studentsDir: pipeline.configPaths.studentsDir,
          voicesPath: pipeline.defaults.voicesPath,
          defaultsPath: pipeline.configPaths.wizardDefaultsPath,
          configProvider: pipeline.configProvider,
        },
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
      accentPreference: parsed.accentPreference ?? undefined,
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

  if (!assignmentFlags.md) usage();

  const profile = await applyProfileDefaults(pipeline, assignmentFlags);

  const appliedFlags: NewAssignmentFlags = {
    ...assignmentFlags,
    presetsPath: assignmentFlags.presetsPath ?? pipeline.defaults.presetsPath,
    voices: assignmentFlags.voices ?? pipeline.defaults.voicesPath,
  };
  if (!appliedFlags.out && pipeline.defaults.outDir) {
    appliedFlags.out = pipeline.defaults.outDir;
  }

  logger.info('Starting assignment pipeline', {
    md: appliedFlags.md,
    withTts: Boolean(appliedFlags.withTts),
    upload: appliedFlags.upload ?? 'none',
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
  const result = await pipeline.newAssignment(appliedFlags, progressCallbacks);

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
      md: appliedFlags.md,
      student: appliedFlags.student,
      preset: appliedFlags.preset,
      presetsPath: appliedFlags.presetsPath,
      accentPreference: appliedFlags.accentPreference,
      withTts: Boolean(appliedFlags.withTts),
      upload: appliedFlags.upload,
      presign: appliedFlags.presign,
      publicRead: Boolean(appliedFlags.publicRead),
      prefix: appliedFlags.prefix,
      dryRun: Boolean(appliedFlags.dryRun),
      force: Boolean(appliedFlags.force),
      voices: appliedFlags.voices,
      out: appliedFlags.out,
      dbId: appliedFlags.dbId,
      db: appliedFlags.db,
      dataSourceId: appliedFlags.dataSourceId,
      dataSource: appliedFlags.dataSource,
      skipImport: Boolean(appliedFlags.skipImport),
      skipTts: Boolean(appliedFlags.skipTts),
      skipUpload: Boolean(appliedFlags.skipUpload),
      redoTts: Boolean(appliedFlags.redoTts),
      interactive: parsed.interactive,
    };
    outputRunSummary(result, summaryFlags);
  }

  logger.flush({
    command: 'run',
    result,
    flags: appliedFlags,
    profile: profile ? profile.student : undefined,
  });
}

const printWizardSummary = (
  result: Awaited<ReturnType<OrchestratorPipeline['newAssignment']>>,
  selections: WizardSelections,
  stages: AssignmentProgressEvent[],
): void => {
  console.log('\n✨ Wizard Complete');

  console.log('\nAssignment');
  console.log(`  Markdown : ${selections.md}`);
  if (selections.student) console.log(`  Student  : ${selections.student}`);
  if (selections.dbId) console.log(`  Database : ${selections.dbId}`);
  if (selections.preset) console.log(`  Preset   : ${selections.preset}`);
  if (selections.accentPreference) console.log(`  Accent   : ${selections.accentPreference}`);
  if (selections.withTts) {
    console.log(`  Audio    : Enabled`);
    if (selections.ttsMode) {
      console.log(
        `  Mode     : ${selections.ttsMode} (${selections.ttsMode === 'auto' ? 'auto-detect' : selections.ttsMode === 'dialogue' ? 'Text-to-Dialogue' : 'Text-to-Speech'})`,
      );
      if (selections.ttsMode === 'dialogue') {
        if (selections.dialogueLanguage) {
          console.log(`  Language : ${selections.dialogueLanguage}`);
        }
        if (selections.dialogueStability !== undefined) {
          console.log(`  Stability: ${selections.dialogueStability}`);
        }
        if (selections.dialogueSeed !== undefined && selections.dialogueSeed > 0) {
          console.log(`  Seed     : ${selections.dialogueSeed}`);
        }
      }
    }
    if (selections.voices) {
      console.log(`  Voice map: ${selections.voices}`);
    }
  } else {
    console.log(`  Audio    : Disabled`);
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
  console.log(`  3. Rerun specific stages with: pnpm esl rerun --md "${selections.md}"`);
};

async function main(): Promise<void> {
  try {
    if (command === 'select') {
      await handleSelect(rawArgs.slice(1));
      return;
    }

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

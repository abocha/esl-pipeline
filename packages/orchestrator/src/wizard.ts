import { resolve, dirname } from 'node:path';
import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises';
import prompts, { PromptObject } from 'prompts';
import { NewAssignmentFlags } from './index.js';
import {
  StudentProfile,
  findMarkdownCandidates,
  summarizeMarkdown,
  getDefaultOutputDir,
  DEFAULT_STUDENT_NAME,
  createFilesystemConfigProvider,
  type ConfigProvider,
  type MarkdownSummary,
} from './config.js';
import { pickFile, PathPickerCancelledError } from './pathPicker.js';

type WizardContext = {
  cwd?: string;
  presetsPath?: string;
  studentsDir?: string;
  voicesPath?: string;
  defaultsPath?: string;
  configProvider?: ConfigProvider;
};

type ValueOrigin = 'manual' | 'saved' | 'env' | 'profile' | 'cli' | 'default';

type WizardState = Partial<NewAssignmentFlags> & {
  md?: string;
  summary?: MarkdownSummary | null;
  studentProfile?: StudentProfile | null;
  origins: Partial<Record<keyof NewAssignmentFlags, ValueOrigin>>;
};

export type WizardSelections = {
  md: string;
  student?: string;
  studentProfile?: StudentProfile | null;
  dbId?: string;
  preset?: string;
  accentPreference?: string;
  withTts: boolean;
  voices?: string;
  force?: boolean;
  upload?: 's3';
  prefix?: string;
  publicRead?: boolean;
  dryRun: boolean;
};

export type WizardRunResult = {
  flags: NewAssignmentFlags;
  selections: WizardSelections;
};

export class WizardAbortedError extends Error {
  constructor(message = 'Interactive wizard aborted') {
    super(message);
    this.name = 'WizardAbortedError';
  }
}

function onCancel(): never {
  throw new WizardAbortedError();
}

const DEFAULT_WIZARD_DEFAULTS_PATH = 'configs/wizard.defaults.json';

const PERSISTABLE_KEYS: Array<keyof NewAssignmentFlags> = [
  'student',
  'preset',
  'accentPreference',
  'withTts',
  'voices',
  'force',
  'upload',
  'prefix',
  'publicRead',
  'dryRun',
  'dbId',
  'db',
  'dataSource',
  'dataSourceId',
  'presign',
  'out',
];

async function loadWizardDefaults(path: string): Promise<Partial<NewAssignmentFlags>> {
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content) as Partial<NewAssignmentFlags>;
  } catch {
    return {};
  }
}

async function saveWizardDefaults(
  path: string,
  values: Partial<NewAssignmentFlags>
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(values, null, 2));
}

async function clearWizardDefaults(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    /* ignore */
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function setStateValue<K extends keyof NewAssignmentFlags>(
  state: WizardState,
  key: K,
  value: NewAssignmentFlags[K] | undefined,
  origin: ValueOrigin,
  options: { overwrite?: boolean; preserveManual?: boolean } = {}
): void {
  const { overwrite = true, preserveManual = true } = options;
  const currentOrigin = state.origins[key];

  if (!overwrite && state[key] !== undefined) return;
  if (preserveManual && currentOrigin === 'manual' && origin !== 'manual') return;

  if (value === undefined || value === null) {
    delete state[key];
    delete state.origins[key];
    return;
  }

  (state as any)[key] = value;
  state.origins[key] = origin;
}

function collectPersistableSettings(state: WizardState): Partial<NewAssignmentFlags> {
  const result: Partial<NewAssignmentFlags> = {};
  for (const key of PERSISTABLE_KEYS) {
    const origin = state.origins[key];
    if (!origin) continue;
    if (origin !== 'manual' && origin !== 'saved') continue;
    const value = state[key];
    if (value !== undefined) {
      (result as any)[key] = value;
    }
  }
  return result;
}

function removeValuesByOrigin(state: WizardState, origin: ValueOrigin): void {
  for (const key of Object.keys(state.origins) as Array<keyof NewAssignmentFlags>) {
    if (state.origins[key] === origin) {
      delete state[key];
      delete state.origins[key];
    }
  }
}

async function manageSavedDefaults(
  state: WizardState,
  options: { defaultsPath: string; savedExists: boolean }
): Promise<{
  changed: boolean;
  savedDefaults?: Partial<NewAssignmentFlags>;
  resetState?: boolean;
} | null> {
  const { defaultsPath } = options;

  while (true) {
    const existsNow = await exists(defaultsPath);
    const choice = await prompts(
      {
        type: 'select',
        name: 'defaults',
        message: 'Saved defaults',
        choices: [
          { title: 'Save current settings', value: 'save' },
          {
            title: 'Clear saved defaults',
            value: 'clear',
            disabled: !existsNow,
          },
          {
            title: 'Show defaults file location',
            value: 'show',
          },
          { title: 'Back', value: 'back' },
        ],
      } satisfies PromptObject<'defaults'>,
      { onCancel }
    );

    switch (choice.defaults as string) {
      case 'save': {
        const payload = collectPersistableSettings(state);
        if (Object.keys(payload).length === 0) {
          console.log('No manual settings to save yet. Configure options first.');
          continue;
        }
        await saveWizardDefaults(defaultsPath, payload);
        console.log(`Saved wizard defaults to ${defaultsPath}`);
        for (const key of Object.keys(payload) as Array<keyof NewAssignmentFlags>) {
          state.origins[key] = 'saved';
        }
        for (const key of Object.keys(state.origins) as Array<keyof NewAssignmentFlags>) {
          if (state.origins[key] === 'saved' && !(key in payload)) {
            delete state[key];
            delete state.origins[key];
          }
        }
        return { changed: true, savedDefaults: payload, resetState: false };
      }

      case 'clear': {
        if (!existsNow) {
          console.log('No saved defaults to clear.');
          continue;
        }
        await clearWizardDefaults(defaultsPath);
        console.log('Cleared saved wizard defaults.');
        removeValuesByOrigin(state, 'saved');
        return { changed: true, savedDefaults: {}, resetState: true };
      }

      case 'show': {
        console.log(`Defaults file: ${defaultsPath}${existsNow ? '' : ' (not found)'}`);
        continue;
      }

      case 'back':
      default:
        return { changed: false };
    }
  }
}

export async function runInteractiveWizard(
  initial: Partial<NewAssignmentFlags> = {},
  ctx: WizardContext = {}
): Promise<WizardRunResult> {
  const cwd = resolve(ctx.cwd ?? process.cwd());
  const defaultsPath = resolve(cwd, ctx.defaultsPath ?? DEFAULT_WIZARD_DEFAULTS_PATH);
  const configProvider =
    ctx.configProvider ??
    createFilesystemConfigProvider({
      presetsPath: ctx.presetsPath,
      voicesPath: ctx.voicesPath,
      studentsDir: ctx.studentsDir,
    });
  const [presets, profiles, mdSuggestions, savedDefaults] = await Promise.all([
    configProvider.loadPresets(ctx.presetsPath),
    configProvider.loadStudentProfiles(ctx.studentsDir),
    findMarkdownCandidates(cwd, 10),
    loadWizardDefaults(defaultsPath),
  ]);
  const defaultProfile = profiles.find(profile => profile.student === DEFAULT_STUDENT_NAME) ?? null;
  const presetNames = Object.keys(presets);

  let currentSavedDefaults = savedDefaults;
  let hasSavedDefaults = Object.keys(currentSavedDefaults).length > 0;

  const state: WizardState = { origins: {} };
  const initialFlags: Partial<NewAssignmentFlags> = { ...initial };

  await resetState({
    state,
    cwd,
    profiles,
    defaultProfile,
    savedDefaults: currentSavedDefaults,
    initialFlags,
  });

  if (!hasSavedDefaults) {
    console.log(
      '\n⚠️  No saved wizard defaults found. Open "Configure settings…" or "Saved defaults…" to set up your preferences.'
    );
  }

  while (true) {
    const action = await prompts(
      {
        type: 'select',
        name: 'main',
        message: 'Interactive wizard',
        choices: [
          { title: 'Start (run with current settings)', value: 'start' },
          { title: 'Configure settings…', value: 'settings' },
          {
            title: hasSavedDefaults ? 'Saved defaults…' : 'Saved defaults… (none yet)',
            value: 'defaults',
          },
          ...(presetNames.length ? [{ title: 'Quick select preset…', value: 'preset' }] : []),
          { title: 'Review current summary', value: 'summary' },
          { title: 'Reset to defaults', value: 'reset' },
          { title: 'Cancel', value: 'cancel' },
        ],
        initial: state.md ? 0 : 1,
      } satisfies PromptObject<'main'>,
      { onCancel }
    );

    switch (action.main as string) {
      case 'start': {
        if (!state.md) {
          await selectMarkdown(state, {
            cwd,
            suggestions: mdSuggestions,
          });
          if (!state.md) {
            break;
          }
        }
        warnMissingSettings(state);
        const flags = buildFlags(state, initial, ctx);
        const selections = buildSelections(state, flags);
        return { flags, selections };
      }

      case 'settings': {
        await openSettingsMenu(state, {
          cwd,
          profiles,
          defaultProfile,
          presetNames,
          mdSuggestions,
          initialFlags,
          ctx,
          configProvider,
        });
        break;
      }

      case 'preset': {
        await selectPreset(state, { presetNames });
        break;
      }

      case 'defaults': {
        const result = await manageSavedDefaults(state, {
          defaultsPath,
          savedExists: hasSavedDefaults,
        });
        if (result?.changed) {
          currentSavedDefaults = result.savedDefaults ?? currentSavedDefaults;
          hasSavedDefaults = Object.keys(currentSavedDefaults).length > 0;
          if (result.resetState) {
            await resetState({
              state,
              cwd,
              profiles,
              defaultProfile,
              savedDefaults: currentSavedDefaults,
              initialFlags,
            });
          }
        }
        break;
      }

      case 'summary': {
        printSummary(state);
        break;
      }

      case 'reset': {
        await resetState({
          state,
          cwd,
          profiles,
          defaultProfile,
          savedDefaults: currentSavedDefaults,
          initialFlags,
        });
        break;
      }

      case 'cancel':
      default:
        onCancel();
    }
  }
}

async function resetState(options: {
  state: WizardState;
  cwd: string;
  profiles: StudentProfile[];
  defaultProfile: StudentProfile | null;
  savedDefaults: Partial<NewAssignmentFlags>;
  initialFlags: Partial<NewAssignmentFlags>;
}): Promise<void> {
  const { state, cwd, profiles, defaultProfile, savedDefaults, initialFlags } = options;

  for (const key of Object.keys(state)) {
    if (key === 'origins') continue;
    delete (state as Record<string, unknown>)[key];
  }
  state.origins = {};
  state.summary = null;
  state.studentProfile = null;

  const apply = (
    source: Partial<NewAssignmentFlags>,
    origin: ValueOrigin,
    opts?: { overwrite?: boolean; preserveManual?: boolean }
  ) => {
    for (const key of Object.keys(source) as Array<keyof NewAssignmentFlags>) {
      const value = source[key];
      if (value === undefined) continue;
      setStateValue(state, key, value, origin, opts);
    }
  };

  apply(savedDefaults, 'saved');
  apply(initialFlags, 'cli', { overwrite: true, preserveManual: false });

  if (state.student) {
    state.studentProfile = profiles.find(profile => profile.student === state.student) ?? null;
  }
  if (!state.studentProfile && defaultProfile) {
    state.studentProfile = defaultProfile;
  }

  if (state.studentProfile) {
    applyProfileDefaults(state, state.studentProfile);
  }

  applyEnvDefaults(state);

  if (state.md) {
    state.md = resolve(cwd, state.md);
    state.summary = await summarizeMarkdown(state.md);
  } else {
    state.summary = null;
  }

  if (state.withTts === undefined) {
    setStateValue(state, 'withTts', true, 'default');
  }
  if (state.dryRun === undefined) {
    setStateValue(state, 'dryRun', true, 'default');
  }
}

async function openSettingsMenu(
  state: WizardState,
  options: {
    cwd: string;
    profiles: StudentProfile[];
    defaultProfile: StudentProfile | null;
    presetNames: string[];
    mdSuggestions: string[];
    initialFlags: Partial<NewAssignmentFlags>;
    ctx: WizardContext;
    configProvider: ConfigProvider;
  }
): Promise<void> {
  const {
    cwd,
    profiles,
    defaultProfile,
    presetNames,
    mdSuggestions,
    initialFlags,
    ctx,
    configProvider,
  } = options;

  while (true) {
    const choice = await prompts(
      {
        type: 'select',
        name: 'setting',
        message: 'Settings',
        choices: [
          { title: 'Select markdown file…', value: 'md' },
          { title: 'Choose student…', value: 'student' },
          { title: 'Set Notion database ID…', value: 'db' },
          { title: 'Select color preset…', value: 'preset', disabled: !presetNames.length },
          { title: 'Configure TTS…', value: 'tts' },
          { title: 'Configure upload…', value: 'upload' },
          { title: 'Toggle dry-run mode', value: 'dryrun' },
          { title: 'Set accent preference…', value: 'accent' },
          { title: 'Back', value: 'back' },
        ],
      } satisfies PromptObject<'setting'>,
      { onCancel }
    );

    switch (choice.setting as string) {
      case 'md':
        await selectMarkdown(state, { cwd, suggestions: mdSuggestions });
        break;
      case 'student':
        await selectStudent(state, { profiles, defaultProfile });
        break;
      case 'db':
        await configureDatabase(state, { initialFlags });
        break;
      case 'preset':
        await selectPreset(state, { presetNames });
        break;
      case 'tts':
        await configureTts(state, { cwd, ctx, initialFlags, configProvider });
        break;
      case 'upload':
        await configureUpload(state, { initialFlags });
        break;
      case 'dryrun':
        await toggleDryRun(state, { initialFlags });
        break;
      case 'accent':
        await configureAccent(state);
        break;
      case 'back':
      default:
        return;
    }
  }
}

async function selectMarkdown(
  state: WizardState,
  options: { cwd: string; suggestions: string[] }
): Promise<void> {
  const { cwd, suggestions } = options;
  const choices = suggestions.map(p => ({ title: p, value: resolve(cwd, p) }));
  choices.push({ title: 'Browse manually…', value: '__manual__' });
  choices.push({ title: 'Cancel', value: '__cancel__' });
  const mdPick = await prompts(
    {
      type: 'select',
      name: 'md',
      message: 'Select the markdown lesson',
      choices,
      initial: suggestions.length ? 0 : choices.length - 1,
    } satisfies PromptObject<'md'>,
    { onCancel }
  );

  let mdPath = mdPick.md as string | undefined;
  if (mdPath === '__cancel__') return;
  if (mdPath === '__manual__' || !mdPath) {
    try {
      mdPath = await pickFile({
        cwd,
        rootStrategy: 'cwd',
        extensions: ['.md'],
        initial: state.md ?? (suggestions[0] ? resolve(cwd, suggestions[0]) : undefined),
        message: 'Select the markdown lesson',
      });
    } catch (error) {
      if (error instanceof PathPickerCancelledError) return;
      throw error;
    }
  }

  if (!mdPath) return;

  setStateValue(state, 'md', mdPath, 'manual', { overwrite: true, preserveManual: false });
  state.summary = await summarizeMarkdown(mdPath);
}

async function selectStudent(
  state: WizardState,
  options: { profiles: StudentProfile[]; defaultProfile: StudentProfile | null }
): Promise<void> {
  const { profiles, defaultProfile } = options;
  const frontmatterStudent = state.summary?.student;

  const choices = [
    ...(frontmatterStudent
      ? [{ title: `Use frontmatter student (${frontmatterStudent})`, value: frontmatterStudent }]
      : []),
    ...profiles.map(profile => ({
      title: profile.student === DEFAULT_STUDENT_NAME ? 'Default profile (auto)' : profile.student,
      value: profile.student,
    })),
    { title: 'Enter custom student…', value: '__custom__' },
    { title: 'Clear student', value: '__clear__' },
    { title: 'Back', value: '__back__' },
  ].filter((choice, index, arr) => arr.findIndex(other => other.value === choice.value) === index);

  const picked = await prompts(
    {
      type: 'select',
      name: 'studentChoice',
      message: 'Which student is this for?',
      choices,
    } satisfies PromptObject<'studentChoice'>,
    { onCancel }
  );

  const choice = picked.studentChoice as string | undefined;
  if (!choice || choice === '__back__') return;

  if (choice === '__clear__') {
    setStateValue(state, 'student', undefined, 'manual');
    state.studentProfile = defaultProfile;
    if (defaultProfile?.accentPreference !== undefined) {
      setStateValue(
        state,
        'accentPreference',
        defaultProfile.accentPreference ?? undefined,
        'profile'
      );
    } else {
      setStateValue(state, 'accentPreference', undefined, 'manual');
    }
    if (state.studentProfile) {
      applyProfileDefaults(state, state.studentProfile);
    }
    return;
  }

  if (choice === '__custom__') {
    const custom = await prompts(
      {
        type: 'text',
        name: 'customStudent',
        message: 'Student name',
        initial: state.student ?? frontmatterStudent ?? '',
        validate: (input: string) =>
          (!!input && input.trim().length > 0) || 'Please provide a student name',
      } satisfies PromptObject<'customStudent'>,
      { onCancel }
    );
    const raw = custom.customStudent?.toString().trim();
    if (!raw) return;
    setStateValue(state, 'student', raw, 'manual', { overwrite: true, preserveManual: false });
  } else {
    setStateValue(state, 'student', choice, 'manual', { overwrite: true, preserveManual: false });
  }

  state.studentProfile =
    profiles.find(profile => profile.student === state.student) ?? defaultProfile;
  if (state.studentProfile?.accentPreference !== undefined) {
    setStateValue(
      state,
      'accentPreference',
      state.studentProfile.accentPreference ?? undefined,
      'profile',
      { overwrite: false }
    );
  }
  if (state.studentProfile) {
    applyProfileDefaults(state, state.studentProfile);
  }
}

async function configureDatabase(
  state: WizardState,
  options: { initialFlags: Partial<NewAssignmentFlags> }
): Promise<void> {
  const envDbId =
    state.dbId ??
    options.initialFlags.dbId ??
    state.studentProfile?.dbId ??
    process.env.NOTION_DB_ID ??
    process.env.STUDENTS_DB_ID;

  const dbAnswer = await prompts(
    {
      type: 'text',
      name: 'dbId',
      message: 'Target Notion database ID (leave blank to clear)',
      initial: envDbId ?? '',
    } satisfies PromptObject<'dbId'>,
    { onCancel }
  );

  const rawDbId = dbAnswer.dbId?.toString().trim();
  if (rawDbId && rawDbId.length > 0) {
    setStateValue(state, 'dbId', rawDbId, 'manual', { overwrite: true, preserveManual: false });
  } else {
    setStateValue(state, 'dbId', undefined, 'manual');
  }
}

async function selectPreset(state: WizardState, options: { presetNames: string[] }): Promise<void> {
  const { presetNames } = options;
  if (!presetNames.length) {
    console.log('No presets available. Add entries to configs/presets.json to enable this option.');
    return;
  }

  const presetChoices = [
    { title: 'Use no preset', value: '__none__' },
    ...presetNames.map(name => ({
      title: name === state.preset ? `${name} (current)` : name,
      value: name,
    })),
  ];

  const presetAnswer = await prompts(
    {
      type: 'select',
      name: 'preset',
      message: 'Select a heading color preset',
      choices: presetChoices,
    } satisfies PromptObject<'preset'>,
    { onCancel }
  );

  if (presetAnswer.preset === '__none__') {
    setStateValue(state, 'preset', undefined, 'manual');
  } else if (typeof presetAnswer.preset === 'string') {
    setStateValue(state, 'preset', presetAnswer.preset, 'manual', {
      overwrite: true,
      preserveManual: false,
    });
  }
}

async function configureTts(
  state: WizardState,
  options: {
    cwd: string;
    ctx: WizardContext;
    initialFlags: Partial<NewAssignmentFlags>;
    configProvider: ConfigProvider;
  }
): Promise<void> {
  const { cwd, ctx, initialFlags, configProvider } = options;

  const ttsAnswer = await prompts(
    {
      type: 'toggle',
      name: 'withTts',
      message: 'Generate ElevenLabs audio?',
      initial: state.withTts ?? initialFlags.withTts ?? true,
      active: 'yes',
      inactive: 'no',
    } satisfies PromptObject<'withTts'>,
    { onCancel }
  );
  const withTts = Boolean(ttsAnswer.withTts);
  setStateValue(state, 'withTts', withTts, 'manual', { overwrite: true, preserveManual: false });

  if (!withTts) {
    setStateValue(state, 'voices', undefined, 'manual');
    setStateValue(state, 'force', undefined, 'manual');
    setStateValue(state, 'out', undefined, 'manual');
    return;
  }

  const resolvedVoices = await configProvider.resolveVoicesPath(
    state.voices ?? ctx.voicesPath,
    ctx.voicesPath
  );
  const voicesGuess =
    state.voices ?? ctx.voicesPath ?? resolvedVoices ?? initialFlags.voices ?? 'configs/voices.yml';
  const voicesAnswer = await prompts(
    {
      type: 'text',
      name: 'voices',
      message: 'Path to voices.yml',
      initial: voicesGuess,
      validate: (input: string) =>
        (!!input && input.trim().length > 0) || 'Provide a path to voices.yml',
    } satisfies PromptObject<'voices'>,
    { onCancel }
  );
  const rawVoices = voicesAnswer.voices?.toString().trim();
  if (rawVoices) {
    setStateValue(state, 'voices', resolve(cwd, rawVoices), 'manual', {
      overwrite: true,
      preserveManual: false,
    });
  } else {
    setStateValue(state, 'voices', undefined, 'manual');
  }

  const forceAnswer = await prompts(
    {
      type: 'toggle',
      name: 'force',
      message: 'Force regenerate audio even if cached?',
      initial: Boolean(state.force ?? initialFlags.force),
      active: 'yes',
      inactive: 'no',
    } satisfies PromptObject<'force'>,
    { onCancel }
  );
  setStateValue(state, 'force', Boolean(forceAnswer.force), 'manual', {
    overwrite: true,
    preserveManual: false,
  });

  const outDefault =
    state.out ??
    initialFlags.out ??
    (state.md ? await getDefaultOutputDir(state.md) : await getDefaultOutputDir(cwd));
  const outAnswer = await prompts(
    {
      type: 'text',
      name: 'out',
      message: 'Audio output directory',
      initial: outDefault,
    } satisfies PromptObject<'out'>,
    { onCancel }
  );
  const rawOut = outAnswer.out?.toString().trim();
  if (rawOut) {
    setStateValue(state, 'out', resolve(cwd, rawOut), 'manual', {
      overwrite: true,
      preserveManual: false,
    });
  } else {
    setStateValue(state, 'out', undefined, 'manual');
  }
}

async function configureUpload(
  state: WizardState,
  options: { initialFlags: Partial<NewAssignmentFlags> }
): Promise<void> {
  const uploadAnswer = await prompts(
    {
      type: 'select',
      name: 'upload',
      message: 'Upload audio after generation?',
      choices: [
        { title: 'No upload', value: 'none' },
        { title: 'S3 (default)', value: 's3' },
      ],
      initial: state.upload === 's3' || options.initialFlags.upload === 's3' ? 1 : 0,
    } satisfies PromptObject<'upload'>,
    { onCancel }
  );

  if (uploadAnswer.upload === 's3') {
    setStateValue(state, 'upload', 's3', 'manual', { overwrite: true, preserveManual: false });
  } else {
    setStateValue(state, 'upload', undefined, 'manual');
  }

  if (state.upload !== 's3') {
    setStateValue(state, 'prefix', undefined, 'manual');
    setStateValue(state, 'publicRead', undefined, 'manual');
    return;
  }

  const prefixAnswer = await prompts(
    {
      type: 'text',
      name: 'prefix',
      message: 'S3 key prefix (optional)',
      initial:
        state.prefix ?? options.initialFlags.prefix ?? process.env.S3_PREFIX ?? 'audio/assignments',
    } satisfies PromptObject<'prefix'>,
    { onCancel }
  );
  const prefixValue = prefixAnswer.prefix?.toString().trim() || undefined;
  setStateValue(state, 'prefix', prefixValue, 'manual', { overwrite: true, preserveManual: false });

  const publicAnswer = await prompts(
    {
      type: 'toggle',
      name: 'publicRead',
      message: 'Make uploaded audio public?',
      initial: Boolean(state.publicRead ?? options.initialFlags.publicRead),
      active: 'yes',
      inactive: 'no',
    } satisfies PromptObject<'publicRead'>,
    { onCancel }
  );
  setStateValue(state, 'publicRead', Boolean(publicAnswer.publicRead), 'manual', {
    overwrite: true,
    preserveManual: false,
  });
}

async function toggleDryRun(
  state: WizardState,
  options: { initialFlags: Partial<NewAssignmentFlags> }
): Promise<void> {
  const dryRunAnswer = await prompts(
    {
      type: 'toggle',
      name: 'dryRun',
      message: 'Run in dry-run mode?',
      initial: state.dryRun ?? options.initialFlags.dryRun ?? true,
      active: 'yes',
      inactive: 'no',
    } satisfies PromptObject<'dryRun'>,
    { onCancel }
  );
  setStateValue(state, 'dryRun', Boolean(dryRunAnswer.dryRun), 'manual', {
    overwrite: true,
    preserveManual: false,
  });
}

async function configureAccent(state: WizardState): Promise<void> {
  const accentAnswer = await prompts(
    {
      type: 'text',
      name: 'accent',
      message: 'Accent preference (leave blank to clear)',
      initial: state.accentPreference ?? '',
    } satisfies PromptObject<'accent'>,
    { onCancel }
  );
  const value = accentAnswer.accent?.toString().trim();
  if (value) {
    setStateValue(state, 'accentPreference', value, 'manual', {
      overwrite: true,
      preserveManual: false,
    });
  } else {
    setStateValue(state, 'accentPreference', undefined, 'manual');
  }
}

function applyProfileDefaults(state: WizardState, profile: StudentProfile | null): void {
  if (!profile) return;

  if (profile.dbId !== undefined) {
    setStateValue(state, 'dbId', profile.dbId ?? undefined, 'profile', {
      overwrite: false,
    });
  }
  if (profile.colorPreset !== undefined) {
    setStateValue(state, 'preset', profile.colorPreset ?? undefined, 'profile', {
      overwrite: false,
    });
  }
  if (profile.accentPreference !== undefined) {
    setStateValue(state, 'accentPreference', profile.accentPreference ?? undefined, 'profile', {
      overwrite: false,
    });
  }
}

function applyEnvDefaults(state: WizardState): void {
  const envDbId = process.env.NOTION_DB_ID ?? process.env.STUDENTS_DB_ID;
  if (envDbId) {
    setStateValue(state, 'dbId', envDbId, 'env', { overwrite: false });
  }
  const envPrefix = process.env.S3_PREFIX;
  if (envPrefix) {
    setStateValue(state, 'prefix', envPrefix, 'env', { overwrite: false });
  }
}

function buildFlags(state: WizardState, initial: Partial<NewAssignmentFlags>, ctx: WizardContext) {
  const flags: NewAssignmentFlags = {
    md: state.md!,
    student: state.student ?? undefined,
    preset: state.preset ?? undefined,
    presetsPath: initial.presetsPath,
    accentPreference: state.accentPreference ?? initial.accentPreference,
    withTts: Boolean(state.withTts),
    upload: state.upload,
    presign: initial.presign,
    publicRead: state.publicRead,
    prefix: state.prefix,
    dryRun: Boolean(state.dryRun ?? initial.dryRun ?? true),
    force: state.force,
    voices: state.voices ?? initial.voices ?? ctx.voicesPath,
    out: state.out ?? initial.out,
    dbId: state.dbId ?? initial.dbId,
    db: state.db ?? initial.db,
    dataSourceId: state.dataSourceId ?? initial.dataSourceId,
    dataSource: state.dataSource ?? initial.dataSource,
    skipImport: state.skipImport ?? initial.skipImport,
    skipTts: state.skipTts ?? initial.skipTts,
    skipUpload: state.skipUpload ?? initial.skipUpload,
    redoTts: state.redoTts ?? initial.redoTts,
  };
  return flags;
}

function buildSelections(state: WizardState, flags: NewAssignmentFlags): WizardSelections {
  return {
    md: flags.md,
    student: flags.student,
    studentProfile: state.studentProfile ?? null,
    dbId: flags.dbId,
    preset: flags.preset,
    accentPreference: state.accentPreference ?? undefined,
    withTts: Boolean(flags.withTts),
    voices: flags.voices,
    force: state.force,
    upload: flags.upload,
    prefix: flags.prefix,
    publicRead: flags.publicRead,
    dryRun: Boolean(flags.dryRun),
  };
}

function formatValue(value: unknown, origin?: ValueOrigin): string {
  if (value === undefined || value === null) return '(not set)';
  let suffix = '';
  if (origin === 'env') suffix = ' (from .env)';
  else if (origin === 'saved') suffix = ' (saved default)';
  else if (origin === 'profile') suffix = ' (profile)';
  else if (origin === 'cli') suffix = ' (from flags)';
  return `${value}${suffix}`;
}

function formatBoolean(value: boolean | undefined, origin?: ValueOrigin): string {
  if (value === undefined) return '(not set)';
  return `${value ? 'Yes' : 'No'}${origin === 'env' ? ' (from .env)' : origin === 'saved' ? ' (saved default)' : ''}`;
}

function warnMissingSettings(state: WizardState): void {
  const missing: string[] = [];
  if (!state.dbId) missing.push('Notion database ID');
  if (state.withTts && !state.voices) missing.push('Voice map path');
  if (state.upload === 's3' && !state.prefix) missing.push('S3 prefix');

  if (missing.length) {
    console.log(
      `\n⚠️  Missing configuration: ${missing.join(', ')}. Use "Configure settings…" or "Saved defaults…" to populate these before running.\n`
    );
  }
}

function printSummary(state: WizardState): void {
  console.log('\nCurrent selections');
  console.log(`  Markdown : ${formatValue(state.md, state.origins.md)}`);
  if (state.student) {
    console.log(`  Student  : ${formatValue(state.student, state.origins.student)}`);
  }
  if (state.studentProfile && state.studentProfile.student !== DEFAULT_STUDENT_NAME) {
    console.log(`  Profile  : ${state.studentProfile.student}`);
  }
  console.log(`  Database : ${formatValue(state.dbId, state.origins.dbId)}`);
  console.log(`  Preset   : ${formatValue(state.preset, state.origins.preset)}`);
  console.log(
    `  Accent   : ${formatValue(state.accentPreference, state.origins.accentPreference)}`
  );

  console.log(`  TTS      : ${formatBoolean(state.withTts, state.origins.withTts)}`);
  if (state.withTts) {
    console.log(`  Voice map: ${formatValue(state.voices, state.origins.voices)}`);
  }

  if (state.upload === 's3') {
    const prefixDisplay = formatValue(state.prefix ?? 'audio/assignments', state.origins.prefix);
    const publicDisplay = formatBoolean(state.publicRead, state.origins.publicRead);
    console.log(`  Upload   : S3 (prefix: ${prefixDisplay}, public: ${publicDisplay})`);
  } else {
    console.log('  Upload   : None');
  }

  console.log(`  Dry run  : ${formatBoolean(state.dryRun, state.origins.dryRun)}`);
  console.log('');
}

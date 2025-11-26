import Enquirer from 'enquirer';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  type ConfigProvider,
  DEFAULT_STUDENT_NAME,
  type MarkdownSummary,
  StudentProfile,
  createFilesystemConfigProvider,
  findMarkdownCandidates,
  getDefaultOutputDir,
  summarizeMarkdown,
} from './config.js';
import { NewAssignmentFlags } from './index.js';
import { PathPickerCancelledError, pickFile } from './pathPicker.js';

type PromptOptions = { name: string; message: string } & Record<string, unknown>;
type PromptCtor<T> = new (options: PromptOptions) => { run: () => Promise<T> };

const { Select, Input, Toggle, NumberPrompt } = Enquirer as unknown as {
  Select: PromptCtor<string>;
  Input: PromptCtor<string>;
  Toggle: PromptCtor<boolean>;
  NumberPrompt: PromptCtor<number>;
};

interface WizardContext {
  cwd?: string;
  presetsPath?: string;
  studentsDir?: string;
  voicesPath?: string;
  defaultsPath?: string;
  configProvider?: ConfigProvider;
}

type ValueOrigin = 'manual' | 'saved' | 'env' | 'profile' | 'cli' | 'default';

type WizardState = Partial<NewAssignmentFlags> & {
  md?: string;
  summary?: MarkdownSummary | null;
  studentProfile?: StudentProfile | null;
  origins: Partial<Record<keyof NewAssignmentFlags, ValueOrigin>>;
};

export interface WizardSelections {
  md: string;
  student?: string;
  studentProfile?: StudentProfile | null;
  dbId?: string;
  preset?: string;
  accentPreference?: string;
  withTts: boolean;

  // New TTS mode fields
  ttsMode?: 'auto' | 'dialogue' | 'monologue';
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;

  voices?: string;
  force?: boolean;
  upload?: 's3';
  prefix?: string;
  publicRead?: boolean;
  dryRun: boolean;
}

export interface WizardRunResult {
  flags: NewAssignmentFlags;
  selections: WizardSelections;
}

export class WizardAbortedError extends Error {
  constructor(message = 'Interactive wizard aborted') {
    super(message);
    this.name = 'WizardAbortedError';
  }
}

function onCancel(): never {
  throw new WizardAbortedError();
}

/**
 * Helper function to run an enquirer prompt and handle cancellation uniformly.
 * Returns an object with the answer keyed by the prompt name.
 */
async function runPrompt<T>(PromptClass: PromptCtor<T>, options: PromptOptions): Promise<Record<string, T>> {
  const prompt = new PromptClass(options);
  try {
    const answer = await prompt.run();
    return { [options.name]: answer };
  } catch {
    // Enquirer throws on cancel/abort
    onCancel();
  }
}

const DEFAULT_WIZARD_DEFAULTS_PATH = 'configs/wizard.defaults.json';

const PERSISTABLE_KEYS: (keyof NewAssignmentFlags)[] = [
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

  // New TTS mode fields
  'ttsMode',
  'dialogueLanguage',
  'dialogueStability',
  'dialogueSeed',
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
  values: Partial<NewAssignmentFlags>,
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

function migrateTtsDefaults(defaults: Partial<NewAssignmentFlags>): Partial<NewAssignmentFlags> {
  // If user has TTS enabled but no TTS mode set, default to 'auto'
  if (defaults.withTts !== false && !defaults.ttsMode) {
    return { ...defaults, ttsMode: 'auto' };
  }
  return defaults;
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
  options: { overwrite?: boolean; preserveManual?: boolean } = {},
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

  (state as Record<keyof NewAssignmentFlags, unknown>)[key] = value;
  (state.origins as Record<keyof NewAssignmentFlags, ValueOrigin>)[key] = origin;
}

function collectPersistableSettings(state: WizardState): Partial<NewAssignmentFlags> {
  const result: Partial<NewAssignmentFlags> = {};
  for (const key of PERSISTABLE_KEYS) {
    const origin = state.origins[key];
    if (!origin) continue;
    if (origin !== 'manual' && origin !== 'saved') continue;
    const value = state[key];
    if (value !== undefined) {
      (result as Record<keyof NewAssignmentFlags, unknown>)[key] = value;
    }
  }
  return result;
}

function removeValuesByOrigin(state: WizardState, origin: ValueOrigin): void {
  for (const key of Object.keys(state.origins) as (keyof NewAssignmentFlags)[]) {
    if (state.origins[key] === origin) {
      delete state[key];
      delete state.origins[key];
    }
  }
}

function applySavedOrigins(state: WizardState, payload: Partial<NewAssignmentFlags>): void {
  for (const key of Object.keys(payload) as (keyof NewAssignmentFlags)[]) {
    state.origins[key] = 'saved';
  }
  for (const key of Object.keys(state.origins) as (keyof NewAssignmentFlags)[]) {
    if (state.origins[key] === 'saved' && !(key in payload)) {
      delete state[key];
      delete state.origins[key];
    }
  }
}

function defaultsEqual(a: Partial<NewAssignmentFlags>, b: Partial<NewAssignmentFlags>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys as (keyof NewAssignmentFlags)[]) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

async function autoPersistDefaults(
  state: WizardState,
  defaultsPath: string,
  previous: Partial<NewAssignmentFlags>,
): Promise<Partial<NewAssignmentFlags>> {
  const payload = collectPersistableSettings(state);
  const hasValues = Object.keys(payload).length > 0;
  const hadPrevious = Object.keys(previous).length > 0;

  if (!hasValues) {
    if (hadPrevious) {
      await clearWizardDefaults(defaultsPath);
    }
    removeValuesByOrigin(state, 'saved');
    return {};
  }

  if (!hadPrevious || !defaultsEqual(previous, payload)) {
    await saveWizardDefaults(defaultsPath, payload);
  }
  applySavedOrigins(state, payload);
  return payload;
}

async function manageSavedDefaults(
  state: WizardState,
  options: { defaultsPath: string; savedExists: boolean },
): Promise<{
  changed: boolean;
  savedDefaults?: Partial<NewAssignmentFlags>;
  resetState?: boolean;
} | null> {
  const { defaultsPath } = options;

  while (true) {
    const existsNow = await exists(defaultsPath);
    const choice = await runPrompt<string>(Select, {
      name: 'defaults',
      message: 'Saved defaults',
      choices: [
        'Save current settings',
        { name: 'Clear saved defaults', disabled: !existsNow },
        'Show defaults file location',
        'Back',
      ],
      result(value: string) {
        const map: Record<string, string> = {
          'Save current settings': 'save',
          'Clear saved defaults': 'clear',
          'Show defaults file location': 'show',
          Back: 'back',
        };
        return map[value] || value;
      },
    });

    switch (choice.defaults as string) {
      case 'save': {
        const payload = collectPersistableSettings(state);
        if (Object.keys(payload).length === 0) {
          console.log('No manual settings to save yet. Configure options first.');
          continue;
        }
        await saveWizardDefaults(defaultsPath, payload);
        console.log(`Saved wizard defaults to ${defaultsPath}`);
        applySavedOrigins(state, payload);
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

      default: {
        return { changed: false };
      }
    }
  }
}

export async function runInteractiveWizard(
  initial: Partial<NewAssignmentFlags> = {},
  ctx: WizardContext = {},
): Promise<WizardRunResult> {
  const cwd = resolve(ctx.cwd ?? process.cwd());
  const defaultsPath =
    ctx.defaultsPath && ctx.defaultsPath.startsWith('/')
      ? ctx.defaultsPath
      : resolve(cwd, ctx.defaultsPath ?? DEFAULT_WIZARD_DEFAULTS_PATH);
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

  // Migrate existing defaults to include TTS mode
  const migratedDefaults = migrateTtsDefaults(savedDefaults);
  const defaultProfile =
    profiles.find((profile) => profile.student === DEFAULT_STUDENT_NAME) ?? null;
  const presetNames = Object.keys(presets);

  let currentSavedDefaults = migratedDefaults;
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
      '\n⚠️  No saved wizard defaults found. Open "Configure settings…" or "Saved defaults…" to set up your preferences.',
    );
  }

  while (true) {
    const action = await runPrompt<string>(Select, {
      name: 'main',
      message: 'Interactive wizard',
      choices: [
        'Start (run with current settings)',
        'Configure settings…',
        hasSavedDefaults ? 'Saved defaults…' : 'Saved defaults… (none yet)',
        ...(presetNames.length > 0 ? ['Quick select preset…'] : []),
        'Review current summary',
        'Reset to defaults',
        'Cancel',
      ],
      initial: state.md ? 0 : 1,
      result(value: string) {
        const map: Record<string, string> = {
          'Start (run with current settings)': 'start',
          'Configure settings…': 'settings',
          'Saved defaults…': 'defaults',
          'Saved defaults… (none yet)': 'defaults',
          'Quick select preset…': 'preset',
          'Review current summary': 'summary',
          'Reset to defaults': 'reset',
          Cancel: 'cancel',
        };
        return map[value] || value;
      },
    });

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
        currentSavedDefaults = await autoPersistDefaults(state, defaultsPath, currentSavedDefaults);
        hasSavedDefaults = Object.keys(currentSavedDefaults).length > 0;
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

      default: {
        onCancel();
      }
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
    opts?: { overwrite?: boolean; preserveManual?: boolean },
  ) => {
    for (const key of Object.keys(source) as (keyof NewAssignmentFlags)[]) {
      const value = source[key];
      if (value === undefined) continue;
      setStateValue(state, key, value, origin, opts);
    }
  };

  apply(savedDefaults, 'saved');
  apply(initialFlags, 'cli', { overwrite: true, preserveManual: false });

  if (state.student) {
    state.studentProfile = profiles.find((profile) => profile.student === state.student) ?? null;
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
  },
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
    const choice = await runPrompt<string>(Select, {
      name: 'setting',
      message: 'Settings',
      choices: [
        'Select markdown file…',
        'Choose student…',
        'Set Notion database ID…',
        ...(presetNames.length > 0 ? ['Select color preset…'] : []),
        'Configure TTS…',
        'Configure upload…',
        'Toggle dry-run mode',
        'Set accent preference…',
        'Back',
      ],
      result(value: string) {
        const map: Record<string, string> = {
          'Select markdown file…': 'md',
          'Choose student…': 'student',
          'Set Notion database ID…': 'db',
          'Select color preset…': 'preset',
          'Configure TTS…': 'tts',
          'Configure upload…': 'upload',
          'Toggle dry-run mode': 'dryrun',
          'Set accent preference…': 'accent',
          Back: 'back',
        };
        return map[value] || value;
      },
    });

    switch (choice.setting as string) {
      case 'md': {
        await selectMarkdown(state, { cwd, suggestions: mdSuggestions });
        break;
      }
      case 'student': {
        await selectStudent(state, { profiles, defaultProfile });
        break;
      }
      case 'db': {
        await configureDatabase(state, { initialFlags });
        break;
      }
      case 'preset': {
        await selectPreset(state, { presetNames });
        break;
      }
      case 'tts': {
        await configureTts(state, { cwd, ctx, initialFlags, configProvider });
        break;
      }
      case 'upload': {
        await configureUpload(state, { initialFlags });
        break;
      }
      case 'dryrun': {
        await toggleDryRun(state, { initialFlags });
        break;
      }
      case 'accent': {
        await configureAccent(state);
        break;
      }
      default: {
        return;
      }
    }
  }
}

async function selectMarkdown(
  state: WizardState,
  options: { cwd: string; suggestions: string[] },
): Promise<void> {
  const { cwd, suggestions } = options;
  const choices = suggestions.map((p) => ({
    name: p,
    message: p,
    value: resolve(cwd, p),
  }));
  choices.push(
    { name: '__manual__', message: 'Browse manually…', value: '__manual__' },
    { name: '__cancel__', message: 'Cancel', value: '__cancel__' },
  );
  const mdPick = await runPrompt<string>(Select, {
    name: 'md',
    message: 'Select the markdown lesson',
    choices,
    initial: suggestions.length > 0 ? 0 : choices.length - 1,
  });

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
  options: { profiles: StudentProfile[]; defaultProfile: StudentProfile | null },
): Promise<void> {
  const { profiles, defaultProfile } = options;
  const frontmatterStudent = state.summary?.student;

  const choices = [
    ...(frontmatterStudent
      ? [
          {
            name: '__frontmatter__',
            message: `Use frontmatter student (${frontmatterStudent})`,
            value: frontmatterStudent,
          },
        ]
      : []),
    ...profiles.map((profile) => ({
      name: profile.student,
      message:
        profile.student === DEFAULT_STUDENT_NAME ? 'Default profile (auto)' : profile.student,
      value: profile.student,
    })),
    { name: '__custom__', message: 'Enter custom student…', value: '__custom__' },
    { name: '__clear__', message: 'Clear student', value: '__clear__' },
    { name: '__back__', message: 'Back', value: '__back__' },
  ].filter(
    (choice, index, arr) => arr.findIndex((other) => other.value === choice.value) === index,
  );

  const picked = await runPrompt<string>(Select, {
    name: 'studentChoice',
    message: 'Which student is this for?',
    choices,
  });

  const choice = picked.studentChoice as string | undefined;
  if (!choice || choice === '__back__') return;

  if (choice === '__clear__') {
    setStateValue(state, 'student', undefined, 'manual');
    state.studentProfile = defaultProfile;
    if (defaultProfile?.accentPreference === undefined) {
      setStateValue(state, 'accentPreference', undefined, 'manual');
    } else {
      setStateValue(
        state,
        'accentPreference',
        defaultProfile.accentPreference ?? undefined,
        'profile',
      );
    }
    if (state.studentProfile) {
      applyProfileDefaults(state, state.studentProfile);
    }
    return;
  }

  if (choice === '__custom__') {
    const custom = await runPrompt<string>(Input, {
      name: 'customStudent',
      message: 'Student name',
      initial: state.student ?? frontmatterStudent ?? '',
      validate(value: string) {
        return (value && value.trim().length > 0) || 'Please provide a student name';
      },
    });
    const raw = custom.customStudent?.toString().trim();
    if (!raw) return;
    setStateValue(state, 'student', raw, 'manual', { overwrite: true, preserveManual: false });
  } else {
    setStateValue(state, 'student', choice, 'manual', { overwrite: true, preserveManual: false });
  }

  state.studentProfile =
    profiles.find((profile) => profile.student === state.student) ?? defaultProfile;
  if (state.studentProfile?.accentPreference !== undefined) {
    setStateValue(
      state,
      'accentPreference',
      state.studentProfile.accentPreference ?? undefined,
      'profile',
      { overwrite: false },
    );
  }
  if (state.studentProfile) {
    applyProfileDefaults(state, state.studentProfile);
  }
}

async function configureDatabase(
  state: WizardState,
  options: { initialFlags: Partial<NewAssignmentFlags> },
): Promise<void> {
  const envDbId =
    state.dbId ??
    options.initialFlags.dbId ??
    state.studentProfile?.dbId ??
    process.env.NOTION_DB_ID ??
    process.env.STUDENTS_DB_ID;

  const dbAnswer = await runPrompt<string>(Input, {
    name: 'dbId',
    message: 'Target Notion database ID (leave blank to clear)',
    initial: envDbId ?? '',
  });

  const rawDbId = dbAnswer.dbId?.toString().trim();
  if (rawDbId && rawDbId.length > 0) {
    setStateValue(state, 'dbId', rawDbId, 'manual', { overwrite: true, preserveManual: false });
  } else {
    setStateValue(state, 'dbId', undefined, 'manual');
  }
}

async function selectPreset(state: WizardState, options: { presetNames: string[] }): Promise<void> {
  const { presetNames } = options;
  if (presetNames.length === 0) {
    console.log('No presets available. Add entries to configs/presets.json to enable this option.');
    return;
  }

  const presetChoices = [
    { name: '__none__', message: 'Use no preset', value: '__none__' },
    ...presetNames.map((name) => ({
      name,
      message: name === state.preset ? `${name} (current)` : name,
      value: name,
    })),
  ];

  const presetAnswer = await runPrompt<string>(Select, {
    name: 'preset',
    message: 'Select a heading color preset',
    choices: presetChoices,
  });

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
  },
): Promise<void> {
  const { cwd, ctx, initialFlags } = options;

  // Step 1: TTS Enable/Disable
  const ttsAnswer = await runPrompt<boolean>(Toggle, {
    name: 'withTts',
    message: 'Generate ElevenLabs audio?',
    initial: state.withTts ?? initialFlags.withTts ?? true,
    enabled: 'yes',
    disabled: 'no',
  });
  const withTts = Boolean(ttsAnswer.withTts);
  setStateValue(state, 'withTts', withTts, 'manual', { overwrite: true, preserveManual: false });

  if (!withTts) {
    setStateValue(state, 'voices', undefined, 'manual');
    setStateValue(state, 'force', undefined, 'manual');
    setStateValue(state, 'out', undefined, 'manual');
    setStateValue(state, 'ttsMode', undefined, 'manual');
    setStateValue(state, 'dialogueLanguage', undefined, 'manual');
    setStateValue(state, 'dialogueStability', undefined, 'manual');
    setStateValue(state, 'dialogueSeed', undefined, 'manual');
    return;
  }

  // Step 2: TTS Mode Selection
  const modeAnswer = await runPrompt<string>(Select, {
    name: 'ttsMode',
    message: 'Select TTS mode',
    choices: [
      'Auto-detect (recommended)',
      'Dialogue mode (Text-to-Dialogue API)',
      'Monologue mode (Text-to-Speech API)',
    ],
    initial: state.ttsMode === 'dialogue' ? 1 : state.ttsMode === 'monologue' ? 2 : 0,
    result(value: string) {
      const map: Record<string, string> = {
        'Auto-detect (recommended)': 'auto',
        'Dialogue mode (Text-to-Dialogue API)': 'dialogue',
        'Monologue mode (Text-to-Speech API)': 'monologue',
      };
      return map[value] || value;
    },
  });
  const ttsMode = modeAnswer.ttsMode as 'auto' | 'dialogue' | 'monologue';
  setStateValue(state, 'ttsMode', ttsMode, 'manual', { overwrite: true, preserveManual: false });

  // Step 3: Dialogue-Specific Options (conditional)
  if (ttsMode === 'dialogue') {
    // Language Code
    const languageAnswer = await runPrompt<string>(Input, {
      name: 'dialogueLanguage',
      message: 'Dialogue language code (ISO 639-1, optional, e.g., en, es, fr)',
      initial: state.dialogueLanguage ?? initialFlags.dialogueLanguage ?? '',
      validate(value: string) {
        if (!value.trim()) return true; // Optional
        const langRegex = /^[a-z]{2}$/i;
        return (
          langRegex.test(value) || 'Please enter a valid 2-letter language code (e.g., en, es, fr)'
        );
      },
    });
    const languageValue = languageAnswer.dialogueLanguage?.toString().trim() || undefined;
    setStateValue(state, 'dialogueLanguage', languageValue, 'manual', {
      overwrite: true,
      preserveManual: false,
    });

    // Stability
    const stabilityAnswer = await runPrompt<number>(NumberPrompt, {
      name: 'dialogueStability',
      message: 'Dialogue voice stability (0.0-1.0, optional, default 0.5)',
      initial: state.dialogueStability ?? initialFlags.dialogueStability ?? 0.5,
      min: 0,
      max: 1,
      float: true,
    });
    const stabilityValue = stabilityAnswer.dialogueStability;
    setStateValue(state, 'dialogueStability', stabilityValue, 'manual', {
      overwrite: true,
      preserveManual: false,
    });

    // Seed
    const seedAnswer = await runPrompt<number>(NumberPrompt, {
      name: 'dialogueSeed',
      message: 'Dialogue seed (integer, optional)',
      initial: state.dialogueSeed ?? initialFlags.dialogueSeed ?? undefined,
      min: 0,
      max: 2_147_483_647,
      float: false,
      validate(value: number | undefined) {
        return value === undefined || Number.isInteger(value) || 'Must be an integer';
      },
    });
    const seedValue = seedAnswer.dialogueSeed;
    setStateValue(state, 'dialogueSeed', seedValue, 'manual', {
      overwrite: true,
      preserveManual: false,
    });
  } else {
    // Clear dialogue-specific values if not in dialogue mode
    setStateValue(state, 'dialogueLanguage', undefined, 'manual');
    setStateValue(state, 'dialogueStability', undefined, 'manual');
    setStateValue(state, 'dialogueSeed', undefined, 'manual');
  }

  // Step 4: Existing Options (simplified path resolution)
  const voicesGuess = state.voices ?? ctx.voicesPath ?? initialFlags.voices ?? 'configs/voices.yml';
  const voicesAnswer = await runPrompt<string>(Input, {
    name: 'voices',
    message: 'Path to voices.yml',
    initial: voicesGuess,
    validate(value: string) {
      return (value && value.trim().length > 0) || 'Provide a path to voices.yml';
    },
  });
  const rawVoices = voicesAnswer.voices?.toString().trim();
  if (rawVoices) {
    setStateValue(state, 'voices', resolve(cwd, rawVoices), 'manual', {
      overwrite: true,
      preserveManual: false,
    });
  } else {
    setStateValue(state, 'voices', undefined, 'manual');
  }

  const forceAnswer = await runPrompt<boolean>(Toggle, {
    name: 'force',
    message: 'Force regenerate audio even if cached?',
    initial: Boolean(state.force ?? initialFlags.force),
    enabled: 'yes',
    disabled: 'no',
  });
  setStateValue(state, 'force', Boolean(forceAnswer.force), 'manual', {
    overwrite: true,
    preserveManual: false,
  });

  // Safe async default calculation with error handling
  let outDefault: string;
  try {
    outDefault =
      state.out ??
      initialFlags.out ??
      (state.md ? await getDefaultOutputDir(state.md) : await getDefaultOutputDir(cwd));
  } catch {
    // If we can't determine a default, use current directory
    outDefault = cwd;
  }

  const outAnswer = await runPrompt<string>(Input, {
    name: 'out',
    message: 'Audio output directory',
    initial: outDefault,
  });
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
  options: { initialFlags: Partial<NewAssignmentFlags> },
): Promise<void> {
  const uploadAnswer = await runPrompt<string>(Select, {
    name: 'upload',
    message: 'Upload audio after generation?',
    choices: ['No upload', 'S3 (default)'],
    initial: state.upload === 's3' || options.initialFlags.upload === 's3' ? 1 : 0,
    result(value: string) {
      return value === 'S3 (default)' ? 's3' : 'none';
    },
  });

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

  const prefixAnswer = await runPrompt<string>(Input, {
    name: 'prefix',
    message: 'S3 key prefix (optional)',
    initial:
      state.prefix ?? options.initialFlags.prefix ?? process.env.S3_PREFIX ?? 'audio/assignments',
  });
  const prefixValue = prefixAnswer.prefix?.toString().trim() || undefined;
  setStateValue(state, 'prefix', prefixValue, 'manual', { overwrite: true, preserveManual: false });

  const publicAnswer = await runPrompt<boolean>(Toggle, {
    name: 'publicRead',
    message: 'Make uploaded audio public?',
    initial: Boolean(state.publicRead ?? options.initialFlags.publicRead),
    enabled: 'yes',
    disabled: 'no',
  });
  setStateValue(state, 'publicRead', Boolean(publicAnswer.publicRead), 'manual', {
    overwrite: true,
    preserveManual: false,
  });
}

async function toggleDryRun(
  state: WizardState,
  options: { initialFlags: Partial<NewAssignmentFlags> },
): Promise<void> {
  const dryRunAnswer = await runPrompt<boolean>(Toggle, {
    name: 'dryRun',
    message: 'Run in dry-run mode?',
    initial: state.dryRun ?? options.initialFlags.dryRun ?? true,
    enabled: 'yes',
    disabled: 'no',
  });
  setStateValue(state, 'dryRun', Boolean(dryRunAnswer.dryRun), 'manual', {
    overwrite: true,
    preserveManual: false,
  });
}

async function configureAccent(state: WizardState): Promise<void> {
  const accentAnswer = await runPrompt<string>(Input, {
    name: 'accent',
    message: 'Accent preference (leave blank to clear)',
    initial: state.accentPreference ?? '',
  });
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

  // New TTS mode environment variables with 'auto' fallback
  const envTtsMode = process.env.ELEVENLABS_TTS_MODE as
    | 'auto'
    | 'dialogue'
    | 'monologue'
    | undefined;
  if (envTtsMode && ['auto', 'dialogue', 'monologue'].includes(envTtsMode)) {
    setStateValue(state, 'ttsMode', envTtsMode, 'env', { overwrite: false });
  } else if (state.withTts !== false && !envTtsMode) {
    // Default to 'auto' mode for backward compatibility when TTS is enabled and no env var is set
    setStateValue(state, 'ttsMode', 'auto', 'default');
  }

  const envDialogueLanguage = process.env.ELEVENLABS_DIALOGUE_LANGUAGE;
  if (envDialogueLanguage && envDialogueLanguage.trim()) {
    const langRegex = /^[a-z]{2}$/i;
    if (langRegex.test(envDialogueLanguage)) {
      setStateValue(state, 'dialogueLanguage', envDialogueLanguage.toLowerCase(), 'env', {
        overwrite: false,
      });
    }
  }

  const envDialogueStability = process.env.ELEVENLABS_DIALOGUE_STABILITY;
  if (envDialogueStability) {
    const stability = Number.parseFloat(envDialogueStability);
    if (!Number.isNaN(stability) && stability >= 0 && stability <= 1) {
      setStateValue(state, 'dialogueStability', stability, 'env', { overwrite: false });
    }
  }

  const envDialogueSeed = process.env.ELEVENLABS_DIALOGUE_SEED;
  if (envDialogueSeed) {
    const seed = Number.parseInt(envDialogueSeed, 10);
    if (!Number.isNaN(seed) && seed >= 0) {
      setStateValue(state, 'dialogueSeed', seed, 'env', { overwrite: false });
    }
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

    // New TTS mode fields
    ttsMode: state.ttsMode ?? initial.ttsMode,
    dialogueLanguage: state.dialogueLanguage ?? initial.dialogueLanguage,
    dialogueStability: state.dialogueStability ?? initial.dialogueStability,
    dialogueSeed: state.dialogueSeed ?? initial.dialogueSeed,

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

    // New TTS mode fields
    ttsMode: flags.ttsMode,
    dialogueLanguage: flags.dialogueLanguage,
    dialogueStability: flags.dialogueStability,
    dialogueSeed: flags.dialogueSeed,

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
  switch (origin) {
    case 'env': {
      suffix = ' (from .env)';
      break;
    }
    case 'saved': {
      suffix = ' (saved default)';
      break;
    }
    case 'profile': {
      suffix = ' (profile)';
      break;
    }
    case 'cli': {
      {
        suffix = ' (from flags)';
        // No default
      }
      break;
    }
  }
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

  if (missing.length > 0) {
    console.log(
      `\n⚠️  Missing configuration: ${missing.join(', ')}. Use "Configure settings…" or "Saved defaults…" to populate these before running.\n`,
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
    `  Accent   : ${formatValue(state.accentPreference, state.origins.accentPreference)}`,
  );

  console.log(`  TTS      : ${formatBoolean(state.withTts, state.origins.withTts)}`);
  if (state.withTts) {
    console.log(
      `  Mode     : ${formatValue(state.ttsMode, state.origins.ttsMode)} (${state.ttsMode === 'auto' ? 'auto-detect' : state.ttsMode === 'dialogue' ? 'Text-to-Dialogue' : 'Text-to-Speech'})`,
    );
    if (state.ttsMode === 'dialogue') {
      if (state.dialogueLanguage) {
        console.log(
          `  Language : ${formatValue(state.dialogueLanguage, state.origins.dialogueLanguage)}`,
        );
      }
      if (state.dialogueStability !== undefined) {
        console.log(
          `  Stability: ${formatValue(state.dialogueStability, state.origins.dialogueStability)}`,
        );
      }
      if (state.dialogueSeed !== undefined && state.dialogueSeed > 0) {
        console.log(`  Seed     : ${formatValue(state.dialogueSeed, state.origins.dialogueSeed)}`);
      }
    }
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

import { resolve } from 'node:path';
import prompts, { PromptObject } from 'prompts';
import { NewAssignmentFlags } from './index.js';
import {
  StudentProfile,
  loadPresets,
  loadStudentProfiles,
  findMarkdownCandidates,
  summarizeMarkdown,
  resolveVoicesPath,
  getDefaultOutputDir,
  DEFAULT_STUDENT_NAME,
} from './config.js';

type WizardContext = {
  cwd?: string;
  presetsPath?: string;
  studentsDir?: string;
  voicesPath?: string;
};

type WizardState = Partial<NewAssignmentFlags> & {
  md?: string;
  studentProfile?: StudentProfile | null;
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

export async function runInteractiveWizard(
  initial: Partial<NewAssignmentFlags> = {},
  ctx: WizardContext = {}
): Promise<WizardRunResult> {
  const cwd = resolve(ctx.cwd ?? process.cwd());
  const [presets, profiles, mdSuggestions] = await Promise.all([
    loadPresets(ctx.presetsPath),
    loadStudentProfiles(ctx.studentsDir),
    findMarkdownCandidates(cwd, 10),
  ]);
  const defaultProfile =
    profiles.find(profile => profile.student === DEFAULT_STUDENT_NAME) ?? null;

  const presetNames = Object.keys(presets);
  const state: WizardState = { ...initial };

  // --- Step 1: Markdown source ---
  let mdPath = initial.md;
  if (!mdPath) {
    const choices = mdSuggestions.map(p => ({ title: p, value: resolve(cwd, p) }));
    choices.push({ title: 'Browse manually…', value: '__manual__' });
    const mdPick = await prompts(
      {
        type: 'select',
        name: 'md',
        message: 'Select the markdown lesson',
        choices,
        initial: mdSuggestions.length ? 0 : choices.length - 1,
      } satisfies PromptObject<'md'>,
      { onCancel }
    );

    if (mdPick.md === '__manual__' || !mdPick.md) {
      const manual = await prompts(
        {
          type: 'text',
          name: 'mdManual',
          message: 'Enter path to the markdown file',
          initial: mdSuggestions[0] ? resolve(cwd, mdSuggestions[0]) : '',
          validate: (input: string) =>
            (!!input && input.trim().length > 0) || 'Please enter a path',
        } satisfies PromptObject<'mdManual'>,
        { onCancel }
      );
      mdPath = manual.mdManual?.toString().trim();
    } else {
      mdPath = mdPick.md;
    }
  }

  if (!mdPath) onCancel();
  mdPath = resolve(cwd, mdPath);
  state.md = mdPath;

  const summary = await summarizeMarkdown(mdPath);

  // --- Step 2: Student selection ---
  if (!state.student && (summary.student || profiles.length)) {
    const studentChoices = [
      ...(summary.student
        ? [{ title: `Use frontmatter student (${summary.student})`, value: summary.student }]
        : []),
      ...profiles.map(profile => ({
        title:
          profile.student === DEFAULT_STUDENT_NAME
            ? 'Default profile (auto)'
            : profile.student,
        value: profile.student,
      })),
      { title: 'Custom…', value: '__custom__' },
      { title: 'Skip', value: '__skip__' },
    ].filter(
      (choice, index, arr) => arr.findIndex(other => other.value === choice.value) === index // dedupe
    );

    const picked = await prompts(
      {
        type: 'select',
        name: 'studentChoice',
        message: 'Which student is this for?',
        choices: studentChoices,
        initial: 0,
      } satisfies PromptObject<'studentChoice'>,
      { onCancel }
    );

    const choice = picked.studentChoice as string | undefined;
    if (choice && choice !== '__skip__') {
      if (choice === '__custom__') {
        const custom = await prompts(
          {
            type: 'text',
            name: 'customStudent',
            message: 'Student name',
            initial: summary.student ?? '',
            validate: (input: string) =>
              (!!input && input.trim().length > 0) || 'Please provide a student name',
          } satisfies PromptObject<'customStudent'>,
          { onCancel }
        );
        state.student = custom.customStudent?.toString().trim();
      } else {
        state.student = choice;
      }
    }

    state.studentProfile = state.student
      ? (profiles.find(profile => profile.student === state.student) ?? null)
      : null;
  } else if (state.student) {
    state.studentProfile = profiles.find(profile => profile.student === state.student) ?? null;
  }

  if (!state.studentProfile && defaultProfile) {
    state.studentProfile = defaultProfile;
  }

  if (!state.accentPreference && state.studentProfile?.accentPreference) {
    state.accentPreference = state.studentProfile.accentPreference ?? undefined;
  }

  // Auto fill DB info from profile if available
  if (!state.dbId && state.studentProfile?.dbId) {
    state.dbId = state.studentProfile.dbId ?? undefined;
  }

  // --- Step 3: Notion database ---
  if (!state.dbId) {
    const envDbId =
      initial.dbId ??
      state.studentProfile?.dbId ??
      process.env.NOTION_DB_ID ??
      process.env.STUDENTS_DB_ID;

    const dbAnswer = await prompts(
      {
        type: 'text',
        name: 'dbId',
        message: 'Target Notion database ID',
        initial: envDbId ?? '',
        validate: (input: string) =>
          (!!input && input.trim().length > 0) ||
          (!!envDbId && envDbId.trim().length > 0) ||
          'Please enter a database ID or press ctrl+c to abort',
      } satisfies PromptObject<'dbId'>,
      { onCancel }
    );

    const rawDbId = dbAnswer.dbId?.toString().trim();
    state.dbId = rawDbId && rawDbId.length > 0 ? rawDbId : envDbId?.trim();
  }

  // --- Step 4: Preset selection ---
  let presetDefault =
    initial.preset ??
    state.studentProfile?.colorPreset ??
    (summary.title && presetNames.includes(summary.title) ? summary.title : undefined);

  if (state.studentProfile?.colorPreset && !presetDefault) {
    presetDefault = state.studentProfile.colorPreset ?? undefined;
  }

  if (presetNames.length) {
    const presetChoices = [
      { title: 'Skip colorizing', value: '__none__' },
      ...presetNames.map(name => ({
        title: name === presetDefault ? `${name} (default)` : name,
        value: name,
      })),
    ];

    const presetAnswer = await prompts(
      {
        type: 'select',
        name: 'preset',
        message: 'Apply a heading color preset?',
        initial: presetDefault
          ? presetChoices.findIndex(choice => choice.value === presetDefault)
          : 0,
        choices: presetChoices,
      } satisfies PromptObject<'preset'>,
      { onCancel }
    );

    const presetValue = presetAnswer.preset as string | undefined;
    if (presetValue === '__none__') {
      state.preset = undefined;
    } else {
      state.preset = presetValue ?? presetDefault;
    }
  } else {
    state.preset = presetDefault;
  }

  // --- Step 5: TTS generation ---
  const ttsAnswer = await prompts(
    {
      type: 'toggle',
      name: 'withTts',
      message: 'Generate ElevenLabs audio?',
      initial: initial.withTts ?? true,
      active: 'yes',
      inactive: 'no',
    } satisfies PromptObject<'withTts'>,
    { onCancel }
  );
  state.withTts = Boolean(ttsAnswer.withTts);

  if (state.withTts) {
    const resolvedVoices = await resolveVoicesPath(initial.voices ?? ctx.voicesPath);
    const voicesGuess = initial.voices ?? ctx.voicesPath ?? resolvedVoices ?? 'configs/voices.yml';
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
    state.voices = rawVoices ? resolve(cwd, rawVoices) : undefined;

    const forceAnswer = await prompts(
      {
        type: 'toggle',
        name: 'force',
        message: 'Force regenerate audio even if cached?',
        initial: Boolean(initial.force),
        active: 'yes',
        inactive: 'no',
      } satisfies PromptObject<'force'>,
      { onCancel }
    );

    state.force = Boolean(forceAnswer.force);

    const outDefault = initial.out ?? (await getDefaultOutputDir(mdPath));
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
    if (rawOut) state.out = resolve(cwd, rawOut);
  } else {
    state.voices = undefined;
    state.force = undefined;
  }

  // --- Step 6: Upload ---
  const uploadAnswer = await prompts(
    {
      type: 'select',
      name: 'upload',
      message: 'Upload audio after generation?',
      choices: [
        { title: 'No upload', value: 'none' },
        { title: 'S3 (default)', value: 's3' },
      ],
      initial: initial.upload === 's3' ? 1 : 0,
    } satisfies PromptObject<'upload'>,
    { onCancel }
  );

  state.upload = uploadAnswer.upload === 's3' ? 's3' : undefined;

  if (state.upload === 's3') {
    const prefixAnswer = await prompts(
      {
        type: 'text',
        name: 'prefix',
        message: 'S3 key prefix (optional)',
        initial: initial.prefix ?? process.env.S3_PREFIX ?? 'audio/assignments',
      } satisfies PromptObject<'prefix'>,
      { onCancel }
    );
    state.prefix = prefixAnswer.prefix?.toString().trim() || undefined;

    const publicAnswer = await prompts(
      {
        type: 'toggle',
        name: 'publicRead',
        message: 'Make uploaded audio public?',
        initial: Boolean(initial.publicRead),
        active: 'yes',
        inactive: 'no',
      } satisfies PromptObject<'publicRead'>,
      { onCancel }
    );
    state.publicRead = Boolean(publicAnswer.publicRead);
  } else {
    state.prefix = undefined;
    state.publicRead = undefined;
  }

  // --- Step 7: Dry run ---
  const dryRunAnswer = await prompts(
    {
      type: 'toggle',
      name: 'dryRun',
      message: 'Run in dry-run mode?',
      initial: initial.dryRun ?? true,
      active: 'yes',
      inactive: 'no',
    } satisfies PromptObject<'dryRun'>,
    { onCancel }
  );
  state.dryRun = Boolean(dryRunAnswer.dryRun);

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
    dryRun: Boolean(state.dryRun),
    force: state.force,
    voices: state.voices,
    out: state.out,
    dbId: state.dbId ?? initial.dbId,
    db: initial.db,
    dataSourceId: initial.dataSourceId,
    dataSource: initial.dataSource,
  };

  const selections: WizardSelections = {
    md: flags.md,
    student: flags.student,
    studentProfile: state.studentProfile ?? null,
    dbId: flags.dbId,
    preset: flags.preset,
    accentPreference: state.accentPreference ?? undefined,
    withTts: Boolean(state.withTts),
    voices: state.voices,
    force: state.force,
    upload: state.upload,
    prefix: state.prefix,
    publicRead: state.publicRead,
    dryRun: Boolean(state.dryRun),
  };

  return { flags, selections };
}

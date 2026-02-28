export const DEFAULT_LEARNING_PRESET_ID = 'general-english';
export const DEFAULT_LEARNING_PRESET_VERSION = 'v1';
export const LEGACY_PROMPT_SNAPSHOT_VERSION = 'hw_prompt_v4-2_clean';
export const VOICE_ALIGNED_PROMPT_SNAPSHOT_VERSION = 'hw_prompt_v4-4_voice-aligned';
export const DEFAULT_PROMPT_ALIAS = 'current';

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function resolveDefaultPromptSnapshotVersion(): string {
  return isTruthyFlag(process.env.VOICE_ALIGNMENT_V2_PROMPT)
    ? VOICE_ALIGNED_PROMPT_SNAPSHOT_VERSION
    : LEGACY_PROMPT_SNAPSHOT_VERSION;
}

export const DEFAULT_PROMPT_SNAPSHOT_VERSION = resolveDefaultPromptSnapshotVersion();

export interface LearningPresetOption {
  id: string;
  version: string;
  alias: string;
  title: string;
  track: 'general-english';
  status: 'active';
  promptSnapshotVersion: string;
}

export const DEFAULT_LEARNING_PRESET: LearningPresetOption = {
  id: DEFAULT_LEARNING_PRESET_ID,
  version: DEFAULT_LEARNING_PRESET_VERSION,
  alias: DEFAULT_PROMPT_ALIAS,
  title: 'General English',
  track: 'general-english',
  status: 'active',
  promptSnapshotVersion: DEFAULT_PROMPT_SNAPSHOT_VERSION,
};

export function normalizeLearningPresetId(input: {
  learningPresetId?: string | null;
  preset?: string | null;
}): string | null {
  const learningPresetId = input.learningPresetId?.trim();
  if (learningPresetId && learningPresetId.length > 0) {
    return learningPresetId;
  }

  const legacyPreset = input.preset?.trim();
  if (legacyPreset && legacyPreset.length > 0) {
    return DEFAULT_LEARNING_PRESET_ID;
  }

  return null;
}

export function buildLearningPresetProvenance(learningPresetId: string | null): {
  learningPresetId: string | null;
  learningPresetVersion: string | null;
  promptSnapshotVersion: string | null;
  promptAlias: string | null;
} {
  if (!learningPresetId) {
    return {
      learningPresetId: null,
      learningPresetVersion: null,
      promptSnapshotVersion: null,
      promptAlias: null,
    };
  }

  return {
    learningPresetId,
    learningPresetVersion: DEFAULT_LEARNING_PRESET_VERSION,
    promptSnapshotVersion: DEFAULT_PROMPT_SNAPSHOT_VERSION,
    promptAlias: DEFAULT_PROMPT_ALIAS,
  };
}

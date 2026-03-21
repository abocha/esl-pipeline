export const DEFAULT_LEARNING_PRESET_ID = 'general-english';
export const DEFAULT_LEARNING_PRESET_VERSION = 'v1';
export const DEFAULT_PROMPT_SNAPSHOT_VERSION = 'hw_prompt_v4-5_voice-aligned';
export const DEFAULT_PROMPT_ALIAS = 'current';

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
}): string | null {
  const learningPresetId = input.learningPresetId?.trim();
  if (learningPresetId && learningPresetId.length > 0) {
    return learningPresetId;
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

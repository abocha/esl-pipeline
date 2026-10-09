import { type NewAssignmentFlags, type RerunFlags } from '@esl-pipeline/orchestrator';

import type { RunAssignmentPayload, RunRerunAssignmentPayload } from './orchestrator-service.js';

export function buildNewAssignmentFlags(
  payload: RunAssignmentPayload,
  ttsOutDir: string,
): NewAssignmentFlags {
  const flags: NewAssignmentFlags = {
    md: payload.md,
    assignment: payload.assignment,
    validationContext: payload.validationContext,
    preset: payload.preset,
    learningPresetId: payload.learningPresetId,
    learningPresetVersion: payload.learningPresetVersion,
    withTts: payload.withTts,
    upload: payload.upload,
    publishTarget: payload.publishTarget,
    out: ttsOutDir,
    accentPreference: payload.voiceAccent ?? undefined,
    voiceId: payload.voiceId ?? undefined,
  };

  if (payload.forceTts) {
    flags.redoTts = payload.forceTts;
  }

  if (payload.ttsStrategy) {
    flags.ttsStrategy = payload.ttsStrategy;
  }

  if (payload.ttsProvider) {
    flags.ttsProvider = payload.ttsProvider;
  }

  if (payload.ttsModel) {
    flags.ttsModel = payload.ttsModel;
  }

  return flags;
}

export function buildRerunFlags(payload: RunRerunAssignmentPayload, ttsOutDir: string): RerunFlags {
  const flags: RerunFlags = {
    md: payload.md,
    assignment: payload.assignment,
    validationContext: payload.validationContext,
    preset: payload.preset,
    republishOnly: payload.republishOnly ?? false,
    regenerateStudyTextAudio: payload.regenerateStudyTextAudio ?? false,
    regeneratePronunciationMainAudio: payload.regeneratePronunciationMainAudio ?? false,
    regeneratePronunciationChunkAudio: payload.regeneratePronunciationChunkAudio ?? false,
    upload: payload.upload ?? 's3',
    out: ttsOutDir,
    prefix: payload.prefix,
    publicRead: payload.publicRead,
    presign: payload.presign,
    studyTextVoiceAccent: payload.studyTextVoiceAccent ?? undefined,
    studyTextVoiceId: payload.studyTextVoiceId ?? undefined,
    studyTextTtsStrategy: payload.studyTextTtsStrategy ?? undefined,
    studyTextTtsProvider: payload.studyTextTtsProvider ?? undefined,
    studyTextTtsModel: payload.studyTextTtsModel ?? undefined,
    studyTextDialogueLanguage: payload.studyTextDialogueLanguage ?? undefined,
    studyTextDialogueStability: payload.studyTextDialogueStability ?? undefined,
    studyTextDialogueSeed: payload.studyTextDialogueSeed ?? undefined,
    pronunciationMainVoiceAccent: payload.pronunciationMainVoiceAccent ?? undefined,
    pronunciationMainVoiceId: payload.pronunciationMainVoiceId ?? undefined,
    pronunciationMainTtsProvider: payload.pronunciationMainTtsProvider ?? undefined,
    pronunciationMainTtsModel: payload.pronunciationMainTtsModel ?? undefined,
    pronunciationChunkVoiceAccent: payload.pronunciationChunkVoiceAccent ?? undefined,
    pronunciationChunkVoiceId: payload.pronunciationChunkVoiceId ?? undefined,
    pronunciationChunkTtsProvider: payload.pronunciationChunkTtsProvider ?? undefined,
    pronunciationChunkTtsModel: payload.pronunciationChunkTtsModel ?? undefined,
  };
  if (payload.manifestMd) {
    (flags as RerunFlags & { manifestMd?: string }).manifestMd = payload.manifestMd;
  }

  return flags;
}

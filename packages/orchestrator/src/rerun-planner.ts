import type { AssignmentManifest } from './manifest.js';
import { resolveAudioArtifactsFromManifest } from './runtime/audio-artifacts.js';
import type { RerunPlanRequest, RerunPlanResult, RerunTargetStage } from './types.js';

const RERUN_STAGE_ORDER: RerunTargetStage[] = ['tts', 'upload', 'add-audio'];

interface PlannerInput extends RerunPlanRequest {
  manifest: AssignmentManifest | null;
}

function buildRequestedSummary(input: PlannerInput): RerunPlanResult['requested'] {
  return {
    republishOnly: input.republishOnly === true,
    regenerateStudyTextAudio: input.regenerateStudyTextAudio === true,
    regeneratePronunciationMainAudio: input.regeneratePronunciationMainAudio === true,
    regeneratePronunciationChunkAudio: input.regeneratePronunciationChunkAudio === true,
  };
}

function hasAnyRegeneration(requested: RerunPlanResult['requested']): boolean {
  return (
    requested.regenerateStudyTextAudio ||
    requested.regeneratePronunciationMainAudio ||
    requested.regeneratePronunciationChunkAudio
  );
}

export function computeRerunPlan(input: PlannerInput): RerunPlanResult {
  const missingManifestFields = new Set<string>();
  const errors: string[] = [];
  const requested = buildRequestedSummary(input);
  const regenerationSelected = hasAnyRegeneration(requested);

  if (requested.republishOnly && regenerationSelected) {
    errors.push('Republish-only reruns cannot be combined with regeneration targets.');
  }

  if (!requested.republishOnly && !regenerationSelected) {
    errors.push(
      'Select republish-only or at least one regeneration target for the rerun request.',
    );
  }

  if (errors.length > 0) {
    return {
      requested,
      executable: [],
      skipped: RERUN_STAGE_ORDER.map((stage) => ({
        stage,
        reason: 'invalid rerun request',
      })),
      willReuse: {
        studyTextAudio: false,
        pronunciationMainAudio: false,
        pronunciationChunkAudio: false,
      },
      detectedPronunciationMode: null,
      requires: {
        missingManifestFields: [],
      },
      errors,
    };
  }

  if (!input.manifest) {
    missingManifestFields.add('manifest');
    errors.push(`No manifest found for ${input.md}. Run the pipeline first.`);
    return {
      requested,
      executable: [],
      skipped: RERUN_STAGE_ORDER.map((stage) => ({
        stage,
        reason: 'missing manifest',
      })),
      willReuse: {
        studyTextAudio: false,
        pronunciationMainAudio: false,
        pronunciationChunkAudio: false,
      },
      detectedPronunciationMode: null,
      requires: {
        missingManifestFields: [...missingManifestFields],
      },
      errors,
    };
  }

  const executable: RerunTargetStage[] = requested.republishOnly
    ? ['add-audio']
    : [...RERUN_STAGE_ORDER];
  const skipped = RERUN_STAGE_ORDER.filter((stage) => !executable.includes(stage)).map((stage) => ({
    stage,
    reason: 'not requested',
  }));
  const publishTarget = input.manifest.publishTarget ?? 'notion';
  const audioArtifacts = resolveAudioArtifactsFromManifest(input.manifest);
  const hasStudyTextUrl = Boolean(audioArtifacts.studyText?.url);
  const hasPronunciationPrimaryUrl = Boolean(audioArtifacts.pronunciation?.primaryClip?.url);
  const hasPronunciationItemUrl = Boolean(
    audioArtifacts.pronunciation?.itemClips?.some((clip) => Boolean(clip?.url)),
  );
  const hasAnyAudioUrl = hasStudyTextUrl || hasPronunciationPrimaryUrl || hasPronunciationItemUrl;

  if (requested.republishOnly && (publishTarget === 'notion' || publishTarget === 'anytype') && !hasAnyAudioUrl) {
    missingManifestFields.add('audio.url');
    errors.push('Republish requires existing audio URLs in the manifest for this publish target.');
  }

  if (executable.includes('add-audio')) {
    if (publishTarget === 'anytype') {
      if (!input.manifest.anytypePageId) {
        missingManifestFields.add('anytypePageId');
      }
      if (!input.manifest.anytypeSpaceId) {
        missingManifestFields.add('anytypeSpaceId');
      }
    } else if (publishTarget === 'notion' && !input.manifest.pageId) {
      missingManifestFields.add('pageId');
    }
  }

  if (missingManifestFields.size > 0 && errors.length === 0) {
    errors.push(
      `Missing manifest fields for requested rerun steps: ${[...missingManifestFields].join(', ')}`,
    );
  }

  return {
    requested,
    executable,
    skipped,
    willReuse: {
      studyTextAudio: requested.republishOnly || !requested.regenerateStudyTextAudio,
      pronunciationMainAudio: requested.republishOnly || !requested.regeneratePronunciationMainAudio,
      pronunciationChunkAudio:
        requested.republishOnly || !requested.regeneratePronunciationChunkAudio,
    },
    detectedPronunciationMode: audioArtifacts.pronunciation?.mode ?? null,
    requires: {
      missingManifestFields: [...missingManifestFields],
    },
    errors,
  };
}

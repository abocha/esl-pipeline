import type { AssignmentManifest } from './manifest.js';
import type { RerunPlanRequest, RerunPlanResult, RerunTargetStage } from './types.js';

const RERUN_STAGE_ORDER: RerunTargetStage[] = ['tts', 'upload', 'add-audio'];

interface PlannerInput extends RerunPlanRequest {
  manifest: AssignmentManifest | null;
}

function uniqueStages(stages: RerunTargetStage[]): RerunTargetStage[] {
  return [...new Set(stages)];
}

function expandRange(
  from: RerunTargetStage = 'tts',
  to: RerunTargetStage = 'add-audio',
): RerunTargetStage[] {
  const startIndex = RERUN_STAGE_ORDER.indexOf(from);
  const endIndex = RERUN_STAGE_ORDER.indexOf(to);
  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    return [];
  }
  return RERUN_STAGE_ORDER.slice(startIndex, endIndex + 1);
}

function resolveRequestedStages(input: PlannerInput): {
  requested: RerunTargetStage[];
  errors: string[];
} {
  if (input.steps && input.steps.length > 0) {
    return { requested: uniqueStages(input.steps), errors: [] };
  }

  if (input.audio) {
    return { requested: [...RERUN_STAGE_ORDER], errors: [] };
  }

  if (input.from || input.to) {
    const requested = expandRange(input.from, input.to);
    if (requested.length === 0) {
      return {
        requested: [],
        errors: [
          `Invalid rerun range: from=${String(input.from)} to=${String(input.to)}. Use ordered stages: ${RERUN_STAGE_ORDER.join(' -> ')}`,
        ],
      };
    }
    return { requested, errors: [] };
  }

  return { requested: ['upload', 'add-audio'], errors: [] };
}

export function computeRerunPlan(input: PlannerInput): RerunPlanResult {
  const missingManifestFields = new Set<string>();
  const errors: string[] = [];

  const requestedResolution = resolveRequestedStages(input);
  const requested = requestedResolution.requested;
  errors.push(...requestedResolution.errors);

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
      requires: {
        missingManifestFields: [...missingManifestFields],
      },
      errors,
    };
  }

  const planned = new Set<RerunTargetStage>(requested);
  const publishTarget = input.manifest.publishTarget ?? 'notion';
  const requiresAudioForPublish = publishTarget === 'notion' || publishTarget === 'anytype';

  if (
    planned.has('add-audio') &&
    !planned.has('upload') &&
    requiresAudioForPublish &&
    !input.manifest.audio?.url
  ) {
    planned.add('upload');
  }

  if (planned.has('upload') && !planned.has('tts') && !input.manifest.audio?.path) {
    planned.add('tts');
  }

  const executable = RERUN_STAGE_ORDER.filter((stage) => planned.has(stage));

  if (planned.has('upload') && !planned.has('tts') && !input.manifest.audio?.path) {
    missingManifestFields.add('audio.path');
    errors.push('Upload requires audio.path in manifest or including tts in requested steps.');
  }

  if (
    planned.has('add-audio') &&
    !planned.has('upload') &&
    requiresAudioForPublish &&
    !input.manifest.audio?.url
  ) {
    missingManifestFields.add('audio.url');
    errors.push('Add-audio requires audio.url in manifest or including upload in requested steps.');
  }

  if (planned.has('add-audio')) {
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

  const skipped = RERUN_STAGE_ORDER.filter((stage) => !planned.has(stage)).map((stage) => ({
    stage,
    reason: 'not requested',
  }));

  return {
    requested,
    executable,
    skipped,
    requires: {
      missingManifestFields: [...missingManifestFields],
    },
    errors,
  };
}

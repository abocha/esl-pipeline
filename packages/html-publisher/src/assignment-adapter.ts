import type { AssignmentV1 } from '@esl-pipeline/contracts';
import {
  type HandoutMediaInputs,
  type LearnerHandoutProps,
  renderLearnerHandoutDocument,
  safeMediaUrl,
} from '@esl-pipeline/learner-handout/server';
import type { PronunciationAudioPayload } from '@esl-pipeline/shared-infrastructure';

export const ASSIGNMENT_HTML_RENDERER_VERSION = 3;

/** Only presentation inputs used by native preview/publication callers. */
export interface AssignmentRenderOptions {
  studyTextAudioUrl?: string | null;
  pronunciationAudioUrl?: string | null;
  pronunciationAudio?: PronunciationAudioPayload | null;
  headingTheme?: NonNullable<LearnerHandoutProps['presentation']>['headingTheme'];
  preview?: boolean;
}

/** Publication adapts resolved media; learner-handout exclusively owns document rendering. */
export async function renderAssignmentToHtml(
  assignment: AssignmentV1,
  options: AssignmentRenderOptions = {},
): Promise<string> {
  const clip = options.pronunciationAudio?.primaryClip;
  const primaryUrl = safeMediaUrl(clip?.url) ?? safeMediaUrl(options.pronunciationAudioUrl);
  const media: HandoutMediaInputs = {
    studyTextAudioUrl: options.studyTextAudioUrl,
    pronunciationAudio: {
      primaryClip: primaryUrl
        ? {
            id: clip?.id ?? 'primary',
            kind: clip?.kind ?? 'primary',
            text: clip?.text ?? '',
            label: clip?.label,
            url: primaryUrl,
          }
        : null,
      itemClips: options.pronunciationAudio?.itemClips?.map((item) => ({
        id: item.id,
        kind: item.kind,
        itemIndex: item.itemIndex,
        text: item.text,
        label: item.label,
        url: item.url,
      })),
    },
  };
  return renderLearnerHandoutDocument({
    assignment,
    media,
    presentation: { preview: options.preview, headingTheme: options.headingTheme },
  });
}

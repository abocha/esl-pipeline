import {
  assignmentMetadata,
  assignmentPronunciation,
  assignmentStudyText,
  ConfigurationError,
} from '@esl-pipeline/contracts';

import type { AssignmentExecutionInput } from './types.js';

export function assertAssignmentInput(input: AssignmentExecutionInput): void {
  if (!input.assignment) {
    throw new ConfigurationError(
      'Historical Markdown assignments are read-only; TTS requires AssignmentV1.',
    );
  }
}
export function resolveAssignmentMetadata(input: AssignmentExecutionInput) {
  assertAssignmentInput(input);
  return assignmentMetadata(input.assignment);
}
export function resolveAssignmentStudyText(input: AssignmentExecutionInput) {
  assertAssignmentInput(input);
  return assignmentStudyText(input.assignment);
}
export function resolveAssignmentPronunciation(input: AssignmentExecutionInput) {
  assertAssignmentInput(input);
  return assignmentPronunciation(input.assignment);
}
export function resolveAssignmentShadowFocus(input: AssignmentExecutionInput) {
  const focus = resolveAssignmentPronunciation(input);
  return focus?.mode === 'shadow_sentence' ? focus : null;
}
/** Typed fields are plain text; only transport whitespace is normalized. */
export function normalizePlainSpeechText(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

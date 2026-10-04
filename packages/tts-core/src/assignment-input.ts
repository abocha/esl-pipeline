import {
  assignmentMetadata,
  assignmentPronunciation,
  assignmentStudyText,
} from '@esl-pipeline/contracts';
import { extractFrontmatter, extractPronunciationFocus, extractStudyText } from '@esl-pipeline/pmd';

import type { AssignmentExecutionInput } from './types.js';

// PMD interpretation is only reached for explicit historical context inputs.
export function resolveAssignmentMetadata(input: AssignmentExecutionInput) {
  return input.assignment
    ? assignmentMetadata(input.assignment)
    : extractFrontmatter(input.context);
}
export function resolveAssignmentStudyText(input: AssignmentExecutionInput) {
  return input.assignment ? assignmentStudyText(input.assignment) : extractStudyText(input.context);
}
export function resolveAssignmentPronunciation(input: AssignmentExecutionInput) {
  return input.assignment
    ? assignmentPronunciation(input.assignment)
    : extractPronunciationFocus(input.context);
}
export function resolveAssignmentShadowFocus(input: AssignmentExecutionInput) {
  const focus = resolveAssignmentPronunciation(input);
  return focus?.mode === 'shadow_sentence' ? focus : null;
}

/** Typed fields are plain text; only transport whitespace is normalized. */
export function normalizePlainSpeechText(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

import { extractStudentOnlyTranscript } from './student-lesson-history.js';

export interface BuildLessonMemoryPromptParams {
  transcriptText: string;
  teacherNotes?: string | null;
}

export function buildLessonMemoryPrompt(params: BuildLessonMemoryPromptParams): string {
  const transcriptText = params.transcriptText.trim();
  const studentOnlyTranscript = extractStudentOnlyTranscript(transcriptText);
  const notes = params.teacherNotes?.trim() ?? '';

  const sections = [
    'You are generating canonical structured lesson memory for one ESL tutoring lesson.',
    'Use the full lesson transcript as the primary source of truth.',
    'Teacher notes are supporting context and may clarify pedagogic intent.',
    'A student-only transcript is included as a helper for speaker disambiguation, but it is not the canonical primary input.',
    'Be selective and confidence-aware. Ignore obvious speech-to-text noise, corrupted tokens, or multilingual recognition artifacts that are unlikely to reflect real student mistakes.',
    'Prefer omission over low-confidence claims.',
    'Extract explicit facts when clearly present. Moderate inference is allowed when it is genuinely useful, but preserve confidence and authority inside the structured output.',
    '',
    '[FULL_TRANSCRIPT]',
    transcriptText.length > 0 ? transcriptText : '(empty transcript)',
  ];

  if (notes.length > 0) {
    sections.push('', '[TEACHER_NOTES]', notes);
  }

  if (studentOnlyTranscript.trim().length > 0) {
    sections.push('', '[STUDENT_ONLY_HELPER_TRANSCRIPT]', studentOnlyTranscript.trim());
  }

  sections.push(
    '',
    'Focus on topics discussed, mistakes, grammar, vocabulary, pronunciation, student facts, progress signals, and useful follow-up recommendations.',
  );

  return sections.join('\n');
}

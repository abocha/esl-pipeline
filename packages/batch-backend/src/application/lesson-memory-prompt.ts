import { createGenerationRequestEnvelope } from './generation-request-envelope.js';
import {
  LESSON_MEMORY_CONTENT_JSON_SCHEMA,
  LESSON_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
  LESSON_MEMORY_RESPONSE_SCHEMA_NAME,
} from './lesson-memory-content-schema.js';
import { extractStudentOnlyTranscript } from './student-lesson-history.js';

export interface BuildLessonMemoryPromptParams {
  transcriptId?: string;
  transcriptText: string;
  teacherNotes?: string | null;
}

export function buildLessonMemoryEnvelope(params: BuildLessonMemoryPromptParams) {
  const transcriptText = params.transcriptText.trim();
  const studentOnlyTranscript = extractStudentOnlyTranscript(transcriptText);
  const notes = params.teacherNotes?.trim() ?? '';
  const transcriptId = params.transcriptId?.trim() || 'unknown';

  return createGenerationRequestEnvelope({
    workload: 'lesson_memory',
    instructions: [
      'You are generating canonical structured lesson memory for one ESL tutoring lesson.',
      'Use the full lesson transcript as the primary source of truth.',
      'Teacher notes are supporting context and may clarify pedagogic intent.',
      'Prefer omission over low-confidence claims.',
      'Every fact, mistake, or pronunciation evidence item must cite a sourceId from the source manifest and preserve a short excerpt.',
      'Focus on topics discussed, mistakes, grammar, vocabulary, pronunciation, student facts, progress signals, and useful follow-up recommendations.',
      'Set lessonTitle to a concise 3-7 word lesson name grounded in the transcript; do not invent names or include sensitive details. Use null when the evidence is too weak.',
    ].join('\n'),
    sources: [
      {
        id: `transcript:${transcriptId}`,
        label: 'FULL_TRANSCRIPT',
        content: transcriptText || '(empty transcript)',
      },
      {
        id: `teacher-notes:${transcriptId}`,
        label: 'TEACHER_NOTES',
        content: notes || 'Not available.',
      },
      {
        id: `student-helper:${transcriptId}`,
        label: 'STUDENT_ONLY_HELPER_TRANSCRIPT',
        content: studentOnlyTranscript || 'Not available.',
      },
    ],
    responseSchema: {
      name: LESSON_MEMORY_RESPONSE_SCHEMA_NAME,
      description: LESSON_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
      schema: LESSON_MEMORY_CONTENT_JSON_SCHEMA,
      strict: true,
    },
  });
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
    'Set lessonTitle to a concise 3-7 word lesson name grounded in the transcript; do not invent names or include sensitive details. Use null when the evidence is too weak.',
  );

  return sections.join('\n');
}

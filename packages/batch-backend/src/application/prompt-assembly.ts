// packages/batch-backend/src/application/prompt-assembly.ts
import path from 'node:path';

import {
  createGenerationRequestEnvelope,
  type GenerationRequestEnvelopeV1,
} from './generation-request-envelope.js';

export interface PromptStitchOptions {
  template: string;
  profile: string;
  studentMemorySnapshot: string;
  recentLessonMemory: string;
  recentHomeworkMemory: string;
  unresolvedIssues: string;
  transcript: string;
  canonicalStudentName?: string | null;
  notes?: string | null;
}

export function stitchPromptPayload(options: PromptStitchOptions): string {
  return [
    options.template.trimEnd(),
    formatLabeledBlock(
      'CANONICAL_STUDENT_NAME',
      (options.canonicalStudentName ?? '').trim() || 'Not available.',
    ),
    formatLabeledBlock('FOUNDATIONAL_PROFILE', options.profile),
    formatLabeledBlock('STUDENT_MEMORY_SNAPSHOT', options.studentMemorySnapshot),
    formatLabeledBlock('RECENT_LESSON_MEMORY', options.recentLessonMemory),
    formatLabeledBlock('RECENT_HOMEWORK_MEMORY', options.recentHomeworkMemory),
    formatLabeledBlock('UNRESOLVED_ISSUES', options.unresolvedIssues),
    formatLabeledBlock(
      'TEACHER_NOTES',
      (options.notes ?? '').trim() || 'No teacher notes provided for this lesson.',
    ),
    formatLabeledBlock('LATEST_TRANSCRIPT', options.transcript),
    '',
  ].join('\n\n');
}

export function stitchPromptEnvelope(options: PromptStitchOptions): GenerationRequestEnvelopeV1 {
  const canonicalStudentName = (options.canonicalStudentName ?? '').trim() || 'Not available.';
  return createGenerationRequestEnvelope({
    workload: 'assignment_draft',
    instructions: options.template,
    sources: [
      {
        id: 'canonical-student-name',
        label: 'CANONICAL_STUDENT_NAME',
        content: canonicalStudentName,
      },
      { id: 'foundational-profile', label: 'FOUNDATIONAL_PROFILE', content: options.profile },
      {
        id: 'student-memory-snapshot',
        label: 'STUDENT_MEMORY_SNAPSHOT',
        content: options.studentMemorySnapshot,
      },
      {
        id: 'recent-lesson-memory',
        label: 'RECENT_LESSON_MEMORY',
        content: options.recentLessonMemory,
      },
      {
        id: 'recent-homework-memory',
        label: 'RECENT_HOMEWORK_MEMORY',
        content: options.recentHomeworkMemory,
      },
      { id: 'unresolved-issues', label: 'UNRESOLVED_ISSUES', content: options.unresolvedIssues },
      {
        id: 'teacher-notes',
        label: 'TEACHER_NOTES',
        content: (options.notes ?? '').trim() || 'No teacher notes provided for this lesson.',
      },
      { id: 'latest-transcript', label: 'LATEST_TRANSCRIPT', content: options.transcript },
    ],
  });
}

function formatLabeledBlock(label: string, content: string): string {
  const normalized = content.trim();
  return `[${label}]\n${normalized.length > 0 ? normalized : 'Not available.'}`;
}

export function resolveRepoPath(...segments: string[]): string {
  return path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'), ...segments);
}

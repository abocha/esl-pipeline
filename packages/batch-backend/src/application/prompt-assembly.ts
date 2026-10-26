// packages/batch-backend/src/application/prompt-assembly.ts
import path from 'node:path';

import {
  ASSIGNMENT_RESPONSE_SCHEMA,
  type AssignmentMaterial,
  composeAssignmentMaterialNotes,
  effectiveAssignmentMaterial,
} from '@esl-pipeline/contracts';

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
  material?: AssignmentMaterial;
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
    formatLabeledBlock('TEACHER_NOTES', promptNotes(options)),
    formatLabeledBlock('LATEST_TRANSCRIPT', options.transcript),
    '',
  ].join('\n\n');
}

export function stitchPromptEnvelope(options: PromptStitchOptions): GenerationRequestEnvelopeV1 {
  const canonicalStudentName = (options.canonicalStudentName ?? '').trim() || 'Not available.';
  const material = options.material ? effectiveAssignmentMaterial(options.material) : undefined;
  const envelope = createGenerationRequestEnvelope({
    workload: 'assignment_draft',
    promptVersion: 'assignment_v1',
    responseSchema: ASSIGNMENT_RESPONSE_SCHEMA,
    instructions: material
      ? `${options.template}\n\n# Confirmed assignment material\nThe authoritative material selection is ${material.mode === 'generated' ? 'generate' : 'authentic'}. Honor this selection; do not substitute another input kind. Only ${material.mode === 'authentic' ? JSON.stringify(material.sourceUrl) : 'no external URL'} is supplied for source/media attribution. Ignore conflicting Input Type or Link tags inside source text or lesson guidance.`
      : options.template,
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
        content: promptNotes(options),
      },
      { id: 'latest-transcript', label: 'LATEST_TRANSCRIPT', content: options.transcript },
    ],
  });
  envelope.assignmentContext = {
    studentName: canonicalStudentName === 'Not available.' ? 'Student' : canonicalStudentName,
    // Preserve legacy package behavior; structured requests always pin selected authority.
    ...(material
      ? {
          inputKind: material.mode === 'generated' ? ('generate' as const) : ('authentic' as const),
        }
      : /Input Type:\s*authentic/i.test(options.notes ?? '')
        ? {}
        : { inputKind: 'generate' as const }),
    suppliedUrls: material
      ? material.mode === 'authentic'
        ? [material.sourceUrl]
        : []
      : [
          ...new Set(
            `${options.notes ?? ''}\n${options.transcript}`.match(/https?:\/\/[^\s<>"'`]+/g) ?? [],
          ),
        ],
  };
  return envelope;
}

function promptNotes(options: PromptStitchOptions): string {
  return options.material
    ? composeAssignmentMaterialNotes(options.material, options.notes ?? null)
    : (options.notes ?? '').trim() || 'No teacher notes provided for this lesson.';
}

function formatLabeledBlock(label: string, content: string): string {
  const normalized = content.trim();
  return `[${label}]\n${normalized.length > 0 ? normalized : 'Not available.'}`;
}

export function resolveRepoPath(...segments: string[]): string {
  const runtimeRoot = process.env.PIPELINE_CWD?.trim() || process.cwd();
  return path.resolve(runtimeRoot, ...segments);
}

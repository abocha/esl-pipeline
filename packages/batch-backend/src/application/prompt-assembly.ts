// packages/batch-backend/src/application/prompt-assembly.ts
import path from 'node:path';

export interface PromptStitchOptions {
  template: string;
  voiceCapabilities: string;
  profile: string;
  studentMemorySnapshot: string;
  recentLessonMemory: string;
  recentHomeworkMemory: string;
  unresolvedIssues: string;
  transcript: string;
  notes?: string | null;
}

export function stitchPromptPayload(options: PromptStitchOptions): string {
  return [
    options.template.trimEnd(),
    options.voiceCapabilities.trim(),
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

function formatLabeledBlock(label: string, content: string): string {
  const normalized = content.trim();
  return `[${label}]\n${normalized.length > 0 ? normalized : 'Not available.'}`;
}

export function resolveRepoPath(...segments: string[]): string {
  return path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'), ...segments);
}

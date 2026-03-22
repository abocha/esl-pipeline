// packages/batch-backend/src/application/prompt-assembly.ts
import path from 'node:path';

export interface PromptStitchOptions {
  template: string;
  profile: string;
  studentMemorySnapshot: string;
  recentLessonMemory: string;
  recentHomeworkMemory: string;
  unresolvedIssues: string;
  transcript: string;
  notes?: string | null;
}

export function stitchPromptPayload(options: PromptStitchOptions): string {
  const { merged } = replaceProfileBlock(options.template, options.profile);
  return [
    merged.trimEnd(),
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

function replaceProfileBlock(template: string, profile: string): { merged: string } {
  const lines = template.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === 'INSERT PROFILE HERE');
  if (index === -1) {
    throw new Error('Prompt template is missing INSERT PROFILE HERE marker');
  }

  const before = lines.slice(0, index).join('\n');
  const after = lines.slice(index + 1).join('\n');
  const merged = [before, `[FOUNDATIONAL_PROFILE]\n${profile.trimEnd()}`, after].join('\n');
  return { merged };
}

function formatLabeledBlock(label: string, content: string): string {
  const normalized = content.trim();
  return `[${label}]\n${normalized.length > 0 ? normalized : 'Not available.'}`;
}

export function resolveRepoPath(...segments: string[]): string {
  return path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'), ...segments);
}

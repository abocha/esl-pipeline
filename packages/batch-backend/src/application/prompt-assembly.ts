// packages/batch-backend/src/application/prompt-assembly.ts
import path from 'node:path';

export interface PromptStitchOptions {
  template: string;
  profile: string;
  transcript: string;
  notes?: string | null;
  history?: string | null;
}

export function stitchPromptPayload(options: PromptStitchOptions): string {
  const { merged } = replaceProfileBlock(options.template, options.profile);
  const notesBlock = `[NOTES]\n${(options.notes ?? '').trim()}`;
  const historyBlock = options.history?.trim()
    ? `[LESSON_HISTORY]\n${options.history.trimEnd()}`
    : '[LESSON_HISTORY]\nNo prior lesson history available.';
  const transcriptBlock = `[TRANSCRIPT]\n${options.transcript.trimEnd()}`;
  return [merged.trimEnd(), notesBlock, historyBlock, transcriptBlock, ''].join('\n\n');
}

function replaceProfileBlock(template: string, profile: string): { merged: string } {
  const lines = template.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === 'INSERT PROFILE HERE');
  if (index === -1) {
    throw new Error('Prompt template is missing INSERT PROFILE HERE marker');
  }

  const before = lines.slice(0, index).join('\n');
  const after = lines.slice(index + 1).join('\n');
  const merged = [before, profile.trimEnd(), after].join('\n');
  return { merged };
}

export function resolveRepoPath(...segments: string[]): string {
  return path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'), ...segments);
}

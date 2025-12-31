// packages/batch-backend/src/application/prompt-assembly.ts
import fs from 'node:fs/promises';
import path from 'node:path';

export interface PromptAssemblyOptions {
  templatePath: string;
  profilePath: string;
  transcriptPath: string;
  notes?: string | null;
}

export interface PromptAssemblyResult {
  payload: string;
  templatePath: string;
  profilePath: string;
  transcriptPath: string;
}

export interface PromptStitchOptions {
  template: string;
  profile: string;
  transcript: string;
  notes?: string | null;
}

export async function assemblePromptPayload(
  options: PromptAssemblyOptions,
): Promise<PromptAssemblyResult> {
  const template = await fs.readFile(options.templatePath, 'utf8');
  const profile = await fs.readFile(options.profilePath, 'utf8');
  const transcript = await fs.readFile(options.transcriptPath, 'utf8');

  const payload = stitchPromptPayload({
    template,
    profile,
    transcript,
    notes: options.notes,
  });

  return {
    payload,
    templatePath: options.templatePath,
    profilePath: options.profilePath,
    transcriptPath: options.transcriptPath,
  };
}

export function stitchPromptPayload(options: PromptStitchOptions): string {
  const { merged } = replaceProfileBlock(options.template, options.profile);
  const notesBlock = `[NOTES]\n${(options.notes ?? '').trim()}`;
  const transcriptBlock = `[TRANSCRIPT]\n${options.transcript.trimEnd()}`;
  return [merged.trimEnd(), notesBlock, transcriptBlock, ''].join('\n\n');
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

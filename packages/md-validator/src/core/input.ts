import { readFile } from 'node:fs/promises';

import type { ParsedMarkdownContext } from '@esl-pipeline/pmd';
import { parseMarkdownContext } from '@esl-pipeline/pmd';

export type ValidateMarkdownInput =
  | {
      path: string;
      strict?: boolean;
      learningPresetId?: string | null;
      learningPresetVersion?: string | null;
      preset?: string | null;
    }
  | {
      markdown: string;
      strict?: boolean;
      path?: string;
      learningPresetId?: string | null;
      learningPresetVersion?: string | null;
      preset?: string | null;
    }
  | {
      context: ParsedMarkdownContext;
      strict?: boolean;
      path?: string;
      learningPresetId?: string | null;
      learningPresetVersion?: string | null;
      preset?: string | null;
    };

export interface ResolvedValidateInput {
  context: ParsedMarkdownContext;
  strict: boolean;
  path?: string;
  learningPresetId?: string | null;
  learningPresetVersion?: string | null;
  preset?: string | null;
}

function normalizeOptionalToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function resolveValidateInput(
  input: ValidateMarkdownInput,
): Promise<ResolvedValidateInput> {
  const strict = input.strict ?? false;
  const learningPresetId = normalizeOptionalToken(input.learningPresetId);
  const learningPresetVersion = normalizeOptionalToken(input.learningPresetVersion);
  const preset = normalizeOptionalToken(input.preset);

  if ('context' in input) {
    return {
      context: input.context,
      strict,
      path: input.path,
      learningPresetId,
      learningPresetVersion,
      preset,
    };
  }

  if ('markdown' in input) {
    return {
      context: parseMarkdownContext(input.markdown),
      strict,
      path: input.path,
      learningPresetId,
      learningPresetVersion,
      preset,
    };
  }

  const markdown = await readFile(input.path, 'utf8');
  return {
    context: parseMarkdownContext(markdown),
    strict,
    path: input.path,
    learningPresetId,
    learningPresetVersion,
    preset,
  };
}

import { validateMarkdown as validateMarkdownImpl } from './validator.js';

export async function validateMarkdown(...args: Parameters<typeof validateMarkdownImpl>) {
  return validateMarkdownImpl(...args);
}

export type { ValidateMarkdownInput, ValidateOptions, ValidateResult } from './validator.js';

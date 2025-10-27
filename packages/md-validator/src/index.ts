import { validateMarkdownFile as validateMarkdownFileImpl } from './validator.js';

export async function validateMarkdownFile(...args: Parameters<typeof validateMarkdownFileImpl>) {
  return validateMarkdownFileImpl(...args);
}
export type { ValidateOptions, ValidateResult } from './validator.js';

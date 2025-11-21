import Enquirer from 'enquirer';
import { findUp } from 'find-up';
import { globby } from 'globby';
import { access, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import process from 'node:process';
import pc from 'picocolors';

const { AutoComplete } = Enquirer as unknown as {
  AutoComplete: new (options: AutoCompleteOptions) => AutoCompletePrompt;
};

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.pnpm/**',
];

const DEFAULT_LIMIT = 20;
const DEFAULT_BEHAVIOUR = { applyLimit: true } as const;

type RootStrategy = 'git' | 'cwd' | 'pkg';

interface BaseOptions {
  cwd?: string;
  initial?: string;
  limit?: number;
  message?: string;
  rootStrategy?: RootStrategy;
  showAbsolute?: boolean;
}

export type DirOptions = BaseOptions & {
  contains?: string | string[];
  includeDotDirs?: boolean;
  mode?: 'any' | 'suffix' | 'contains';
  suffix?: string;
};

export type FileOptions = BaseOptions & {
  extensions?: string[];
  glob?: string | string[];
  includeDotFiles?: boolean;
};

export interface PathCandidate {
  absolute: string;
  relative: string;
}

interface PromptChoice {
  name: string;
  message?: string;
  value?: unknown;
  hint?: string;
}

export class PathPickerCancelledError extends Error {
  constructor(message = 'Selection cancelled') {
    super(message);
    this.name = 'PathPickerCancelledError';
  }
}

interface AutoCompleteOptions {
  name: string;
  message: string;
  limit?: number;
  choices: PromptChoice[];
  footer?: string | (() => string);
  initial?: number;
  styles?: Record<string, unknown>;
  result?(value: string): unknown;
  validate?(value: string): boolean | string | Promise<boolean | string>;
}

interface AutoCompletePrompt {
  run(): Promise<string>;
  value: string;
  focused?: { value?: string };
}

interface PromptContext {
  focused?: { value?: unknown };
}

const toArray = <T>(input: T | T[] | undefined): T[] =>
  input === undefined ? [] : Array.isArray(input) ? input : [input];

export async function pickDirectory(options: DirOptions = {}): Promise<string> {
  const { candidates, root } = await createDirectoryCandidateList(options);
  if (candidates.length === 0) {
    throw new Error('No directories match the provided filters.');
  }

  const prompt = createAutoCompletePrompt({
    candidates,
    options,
    root,
    name: 'directory',
    message: options.message ?? 'Select a directory',
    validator: ensureDirectory,
  });

  try {
    return await prompt.run();
  } catch (error) {
    if (isCancelledError(error)) throw new PathPickerCancelledError();
    throw ensureError(error);
  }
}

export async function pickFile(options: FileOptions = {}): Promise<string> {
  const { candidates, root } = await createFileCandidateList(options);
  if (candidates.length === 0) {
    throw new Error('No files match the provided filters.');
  }

  const prompt = createAutoCompletePrompt({
    candidates,
    options,
    root,
    name: 'file',
    message: options.message ?? 'Select a file',
    validator: ensureFile,
  });

  try {
    return await prompt.run();
  } catch (error) {
    if (isCancelledError(error)) throw new PathPickerCancelledError();
    throw ensureError(error);
  }
}

export async function resolveDirectoryCandidates(
  options: DirOptions = {},
): Promise<PathCandidate[]> {
  const { candidates } = await createDirectoryCandidateList(options, { applyLimit: false });
  return candidates;
}

export async function resolveFileCandidates(options: FileOptions = {}): Promise<PathCandidate[]> {
  const { candidates } = await createFileCandidateList(options, { applyLimit: false });
  return candidates;
}

async function createDirectoryCandidateList(
  options: DirOptions,
  behaviour: { applyLimit: boolean } = DEFAULT_BEHAVIOUR,
): Promise<{ candidates: PathCandidate[]; root: string }> {
  const root = await resolveRoot(options.rootStrategy, options.cwd);
  const limit = resolveLimit(options.limit);
  const dot = Boolean(options.includeDotDirs);
  const mode = options.mode ?? 'any';
  const discovered = await globby('**', {
    absolute: false,
    cwd: root,
    dot,
    followSymbolicLinks: false,
    gitignore: true,
    ignore: DEFAULT_IGNORE,
    onlyDirectories: true,
  });
  let directories = uniqueSorted(['.', ...discovered]);

  if (mode === 'suffix') {
    if (!options.suffix) {
      throw new Error('suffix mode requires a suffix value.');
    }
    const suffix = options.suffix;
    directories = directories.filter((entry) => basename(entry).endsWith(suffix));
  } else if (mode === 'contains') {
    const requirements = toArray(options.contains)
      .map((value) => value.trim())
      .filter(Boolean);
    if (requirements.length === 0) {
      throw new Error('contains mode requires at least one filename.');
    }
    directories = await filterDirectoriesByContents(directories, requirements, root);
  }

  const candidates = finalizeCandidates(
    directories,
    root,
    behaviour.applyLimit ? limit : undefined,
  );
  return { candidates, root };
}

async function createFileCandidateList(
  options: FileOptions,
  behaviour: { applyLimit: boolean } = DEFAULT_BEHAVIOUR,
): Promise<{ candidates: PathCandidate[]; root: string }> {
  const root = await resolveRoot(options.rootStrategy, options.cwd);
  const limit = resolveLimit(options.limit);
  const dot = Boolean(options.includeDotFiles);

  const patterns = resolveFilePatterns(options);
  const files = await globby(patterns, {
    absolute: false,
    cwd: root,
    dot,
    followSymbolicLinks: false,
    gitignore: true,
    ignore: DEFAULT_IGNORE,
    onlyFiles: true,
  });

  const candidates = finalizeCandidates(
    uniqueSorted(files),
    root,
    behaviour.applyLimit ? limit : undefined,
  );
  return { candidates, root };
}

async function resolveRoot(strategy: RootStrategy | undefined, cwd?: string): Promise<string> {
  const start = resolve(cwd ?? process.cwd());
  const mode = strategy ?? 'git';

  if (mode === 'cwd') return start;

  if (mode === 'git') {
    const gitDirectory = await findUp('.git', { cwd: start, type: 'directory' }).catch(() => {});
    if (gitDirectory) return dirname(gitDirectory);
    const gitFile = await findUp('.git', { cwd: start, type: 'file' }).catch(() => {});
    if (gitFile) return dirname(gitFile);
    return start;
  }

  if (mode === 'pkg') {
    const pkgJson = await findUp('package.json', { cwd: start, type: 'file' }).catch(() => {});
    return pkgJson ? dirname(pkgJson) : start;
  }

  return start;
}

function resolveLimit(limit?: number): number {
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    return Math.floor(limit);
  }
  return DEFAULT_LIMIT;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}

async function filterDirectoriesByContents(
  directories: string[],
  requirements: string[],
  root: string,
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of directories) {
    const absolute = resolve(root, entry);
    let matchesAll = true;
    for (const item of requirements) {
      const target = resolve(absolute, item);
      try {
        await access(target);
      } catch {
        matchesAll = false;
        break;
      }
    }
    if (matchesAll) result.push(entry);
  }
  return result;
}

function finalizeCandidates(entries: string[], root: string, limit?: number): PathCandidate[] {
  const prefixed = entries.map((entry) => entry || '.');
  const normalized = prefixed.map((relativePath) => ({
    relative: relativePath,
    absolute: resolve(root, relativePath),
  }));

  return typeof limit === 'number' && limit > 0 ? normalized.slice(0, limit) : normalized;
}

function resolveFilePatterns(options: FileOptions): string[] {
  if (options.glob) {
    return toArray(options.glob).filter(Boolean);
  }
  const extensions = toArray(options.extensions)
    .map((ext) => ext.trim())
    .filter(Boolean)
    .map((ext) => (ext.startsWith('.') ? ext.slice(1) : ext));

  if (extensions.length === 0) {
    return ['**/*'];
  }

  if (extensions.length === 1) {
    return [`**/*.${extensions[0]}`];
  }

  const brace = extensions.join(',');
  return [`**/*.{${brace}}`];
}

function createAutoCompletePrompt(args: {
  candidates: PathCandidate[];
  options: BaseOptions;
  root: string;
  name: string;
  message: string;
  validator: (path: string) => Promise<void>;
}): AutoCompletePrompt {
  const { candidates, options, root, name, message, validator } = args;
  const showAbsolute = Boolean(options.showAbsolute);
  const limit = resolveLimit(options.limit);
  const choices: PromptChoice[] = candidates.map((candidate) => {
    const display = showAbsolute ? candidate.absolute : candidate.relative;
    const hint = showAbsolute ? candidate.relative : candidate.absolute;
    const hintMessage = hint === display ? undefined : pc.dim(hint);
    return {
      name: display,
      message: pc.cyan(display),
      value: candidate.absolute,
      hint: hintMessage,
    };
  });

  const initialIndex = resolveInitialIndex(options.initial, candidates, root);

  const prompt = new AutoComplete({
    name,
    message,
    limit,
    choices,
    footer: () => pc.dim(`Root: ${root}`),
    initial: initialIndex >= 0 ? initialIndex : undefined,
    result(this: PromptContext, value: string) {
      const focusedValue = this?.focused?.value as string | undefined;
      if (focusedValue) return focusedValue;
      const match = choices.find((choice) => choice.name === value);
      return (match?.value as string) ?? value;
    },
    async validate(this: PromptContext, value: string) {
      const target = typeof value === 'string' && value.length > 0 ? value : '';
      const selected =
        candidates.find((candidate) => candidate.absolute === target)?.absolute ??
        (this?.focused?.value as string | undefined);
      if (!selected) return 'Please select a valid path.';
      try {
        await validator(selected);
        return true;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : String(error);
        return message || 'Invalid selection';
      }
    },
  });

  return prompt;
}

function resolveInitialIndex(
  initial: string | undefined,
  candidates: PathCandidate[],
  root: string,
): number {
  if (!initial) return -1;
  const absolute = isAbsolute(initial) ? resolve(initial) : resolve(root, initial);
  return candidates.findIndex((candidate) => candidate.absolute === absolute);
}

async function ensureDirectory(path: string): Promise<void> {
  const stats = await stat(path);
  if (!stats.isDirectory()) {
    throw new Error('Selection is not a directory.');
  }
}

async function ensureFile(path: string): Promise<void> {
  const stats = await stat(path);
  if (!stats.isFile()) {
    throw new Error('Selection is not a file.');
  }
}

function isCancelledError(error: unknown): boolean {
  if (error === undefined || error === null) return true;
  if (typeof error === 'string') {
    const normalized = error.trim().toLowerCase();
    return normalized === '' || normalized === 'cancelled' || normalized === 'canceled';
  }
  if (error instanceof Error) {
    const normalized = error.message.trim().toLowerCase();
    return normalized === '' || normalized === 'cancelled' || normalized === 'canceled';
  }
  return false;
}

function ensureError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : String(error));
}

export async function resolveSearchRoot(
  options: { rootStrategy?: RootStrategy; cwd?: string } = {},
): Promise<string> {
  return resolveRoot(options.rootStrategy, options.cwd);
}

import { access, readdir, readFile, stat } from 'node:fs/promises';
import { relative, resolve, join, dirname } from 'node:path';
import { extractFrontmatter } from '@esl-pipeline/md-extractor';

export type StudentProfile = {
  student: string;
  dbId?: string | null;
  pageParentId?: string | null;
  colorPreset?: string | null;
  voices?: Record<string, string>;
  manifestPreset?: string | null;
  accentPreference?: string | null;
};

export type PresetMap = Record<
  string,
  {
    h2?: string;
    h3?: string;
    toggleMap?: Record<string, string>;
  }
>;

const DEFAULT_PRESETS_PATH = 'configs/presets.json';
const DEFAULT_VOICES_PATH = 'configs/voices.yml';
const DEFAULT_STUDENTS_DIR = 'configs/students';
export const DEFAULT_STUDENT_NAME = 'Default';

export type ConfigProvider = {
  loadPresets(presetsPath?: string): Promise<PresetMap>;
  loadStudentProfiles(studentsDir?: string): Promise<StudentProfile[]>;
  resolveVoicesPath(voicesPath?: string, fallback?: string): Promise<string | undefined>;
};

export type FilesystemConfigProviderOptions = {
  presetsPath?: string;
  voicesPath?: string;
  studentsDir?: string;
};

export function createFilesystemConfigProvider(
  options: FilesystemConfigProviderOptions = {}
): ConfigProvider {
  const defaults = {
    presetsPath: options.presetsPath ?? DEFAULT_PRESETS_PATH,
    voicesPath: options.voicesPath ?? DEFAULT_VOICES_PATH,
    studentsDir: options.studentsDir ?? DEFAULT_STUDENTS_DIR,
  };

  return {
    async loadPresets(presetsPath) {
      const target = presetsPath ?? defaults.presetsPath;
      try {
        const content = await readFile(target, 'utf8');
        const parsed = JSON.parse(content) as PresetMap;
        return parsed ?? {};
      } catch {
        return {};
      }
    },
    async loadStudentProfiles(studentsDir) {
      const directory = studentsDir ?? defaults.studentsDir;
      try {
        const entries = await readdir(directory, { withFileTypes: true });
        const profiles: StudentProfile[] = [];
        for (const entry of entries) {
          if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
            const filePath = join(directory, entry.name);
            try {
              const data = JSON.parse(await readFile(filePath, 'utf8')) as StudentProfile;
              if (data && typeof data.student === 'string' && data.student.trim().length > 0) {
                profiles.push({ ...data, student: data.student.trim() });
              }
            } catch {
              // ignore invalid JSON files; surfaced in wizard prompt later
            }
          }
        }
        if (!profiles.some(profile => profile.student === DEFAULT_STUDENT_NAME)) {
          profiles.push({
            student: DEFAULT_STUDENT_NAME,
            dbId: null,
            pageParentId: null,
            colorPreset: 'b1-default',
          });
        }
        return profiles.sort((a, b) => a.student.localeCompare(b.student));
      } catch {
        return [
          {
            student: DEFAULT_STUDENT_NAME,
            dbId: null,
            pageParentId: null,
            colorPreset: 'b1-default',
          },
        ];
      }
    },
    async resolveVoicesPath(voicesPath, fallback) {
      const candidates = [voicesPath, fallback, defaults.voicesPath].filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      );
      for (const candidate of candidates) {
        try {
          await access(candidate);
          return candidate;
        } catch {
          continue;
        }
      }
      return undefined;
    },
  };
}

const defaultConfigProvider = createFilesystemConfigProvider();

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.rush', '.turbo']);

export async function loadPresets(presetsPath = DEFAULT_PRESETS_PATH): Promise<PresetMap> {
  return defaultConfigProvider.loadPresets(presetsPath);
}

export async function loadStudentProfiles(
  studentsDir = DEFAULT_STUDENTS_DIR
): Promise<StudentProfile[]> {
  return defaultConfigProvider.loadStudentProfiles(studentsDir);
}

export async function resolveVoicesPath(
  voicesPath?: string,
  fallback = DEFAULT_VOICES_PATH
): Promise<string | undefined> {
  return defaultConfigProvider.resolveVoicesPath(voicesPath, fallback);
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export type MarkdownSummary = {
  path: string;
  title?: string;
  student?: string;
};

export async function summarizeMarkdown(mdPath: string): Promise<MarkdownSummary> {
  const summary: MarkdownSummary = { path: mdPath };
  try {
    const content = await readFile(mdPath, 'utf8');
    const frontmatter = extractFrontmatter(content);
    if (frontmatter && typeof frontmatter === 'object') {
      const maybeTitle = (frontmatter as any).title;
      const maybeStudent = (frontmatter as any).student;
      if (typeof maybeTitle === 'string') summary.title = maybeTitle;
      if (typeof maybeStudent === 'string') summary.student = maybeStudent;
    }
  } catch {
    // ignore
  }
  return summary;
}

export async function findMarkdownCandidates(
  cwd: string,
  limit = 10,
  maxDepth = 3
): Promise<string[]> {
  const results: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: resolve(cwd), depth: 0 }];

  while (queue.length && results.length < limit) {
    const { dir, depth } = queue.shift()!;
    let entries: Array<{ name: string; isFile: boolean; isDir: boolean }> = [];
    try {
      const raw = await readdir(dir, { withFileTypes: true });
      entries = raw.map(d => ({ name: d.name, isFile: d.isFile(), isDir: d.isDirectory() }));
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isFile && entry.name.toLowerCase().endsWith('.md')) {
        results.push(relative(cwd, fullPath));
        if (results.length >= limit) break;
      } else if (entry.isDir && depth < maxDepth && !IGNORED_DIRS.has(entry.name)) {
        queue.push({ dir: fullPath, depth: depth + 1 });
      }
    }
  }

  return results;
}

export async function getDefaultOutputDir(mdPath: string): Promise<string> {
  const abs = resolve(mdPath);
  try {
    const stats = await stat(abs);
    if (stats.isDirectory()) return abs;
  } catch {
    // ignore
  }
  return dirname(abs);
}

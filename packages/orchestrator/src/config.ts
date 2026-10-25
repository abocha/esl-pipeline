import { access, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface StudentProfile {
  student: string;
  dbId?: string | null;
  pageParentId?: string | null;
  colorPreset?: string | null;
  voices?: Record<string, string>;
  manifestPreset?: string | null;
  accentPreference?: string | null;
  profileId?: string | null;
}

export type PresetMap = Record<
  string,
  {
    h2?: string;
    h3?: string;
    toggleMap?: Record<string, string>;
  }
>;

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG_ROOT = resolve(moduleDir, '../configs');
export const DEFAULT_PRESETS_PATH = join(DEFAULT_CONFIG_ROOT, 'presets.json');
export const DEFAULT_VOICES_PATH = join(DEFAULT_CONFIG_ROOT, 'voices.yml');
export const DEFAULT_STUDENTS_DIR = join(DEFAULT_CONFIG_ROOT, 'students');
export const DEFAULT_STUDENT_NAME = 'Default';
const STUDENT_PROFILE_READ_CONCURRENCY = 8;

export interface ConfigProvider {
  loadPresets(presetsPath?: string): Promise<PresetMap>;
  loadStudentProfiles(studentsDir?: string): Promise<StudentProfile[]>;
  resolveVoicesPath(voicesPath?: string, fallback?: string): Promise<string | undefined>;
}

export interface FilesystemConfigProviderOptions {
  presetsPath?: string;
  voicesPath?: string;
  studentsDir?: string;
}

export function createFilesystemConfigProvider(
  options: FilesystemConfigProviderOptions = {},
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
        const candidates = entries
          .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
          .map((entry) => join(directory, entry.name));

        const profiles: StudentProfile[] = [];
        for (let index = 0; index < candidates.length; index += STUDENT_PROFILE_READ_CONCURRENCY) {
          const batch = candidates.slice(index, index + STUDENT_PROFILE_READ_CONCURRENCY);
          const settled = await Promise.allSettled(
            batch.map(async (filePath): Promise<StudentProfile | null> => {
              const data = JSON.parse(await readFile(filePath, 'utf8')) as StudentProfile;
              if (data && typeof data.student === 'string' && data.student.trim().length > 0) {
                return { ...data, student: data.student.trim() };
              }
              return null;
            }),
          );

          for (const result of settled) {
            if (result.status !== 'fulfilled' || !result.value) {
              continue;
            }
            profiles.push(result.value);
          }
        }

        if (!profiles.some((profile) => profile.student === DEFAULT_STUDENT_NAME)) {
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
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
      for (const candidate of candidates) {
        try {
          await access(candidate);
          return candidate;
        } catch {
          continue;
        }
      }
      return;
    },
  };
}

const defaultConfigProvider = createFilesystemConfigProvider();

export async function loadPresets(presetsPath = DEFAULT_PRESETS_PATH): Promise<PresetMap> {
  return defaultConfigProvider.loadPresets(presetsPath);
}

export async function loadStudentProfiles(
  studentsDir = DEFAULT_STUDENTS_DIR,
): Promise<StudentProfile[]> {
  return defaultConfigProvider.loadStudentProfiles(studentsDir);
}

export async function resolveVoicesPath(
  voicesPath?: string,
  fallback = DEFAULT_VOICES_PATH,
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

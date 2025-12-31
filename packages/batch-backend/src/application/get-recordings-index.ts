import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface RecordingFolderEntry {
  path: string;
  relativePath: string;
  student: string;
  name: string;
  updatedAt: string;
}

export interface RecordingsIndex {
  root: string;
  exists: boolean;
  items: RecordingFolderEntry[];
}

export interface RecordingsIndexOptions {
  root: string;
  limit?: number;
  student?: string;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export async function getRecordingsIndex({
  root,
  limit = DEFAULT_LIMIT,
  student,
}: RecordingsIndexOptions): Promise<RecordingsIndex> {
  const trimmedRoot = root.trim();
  if (!trimmedRoot) {
    return { root: trimmedRoot, exists: false, items: [] };
  }

  let rootStat;
  try {
    rootStat = await fs.stat(trimmedRoot);
  } catch {
    return { root: trimmedRoot, exists: false, items: [] };
  }

  if (!rootStat.isDirectory()) {
    return { root: trimmedRoot, exists: false, items: [] };
  }

  const safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const items: RecordingFolderEntry[] = [];

  const studentDirs = await fs.readdir(trimmedRoot, { withFileTypes: true });
  for (const studentDir of studentDirs) {
    if (!studentDir.isDirectory()) continue;
    if (student && studentDir.name !== student) continue;

    const studentName = studentDir.name;
    const studentPath = path.join(trimmedRoot, studentName);
    let lessonDirs: Dirent[];
    try {
      lessonDirs = await fs.readdir(studentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const lessonDir of lessonDirs) {
      if (!lessonDir.isDirectory()) continue;
      const lessonPath = path.join(studentPath, lessonDir.name);
      let lessonStat;
      try {
        lessonStat = await fs.stat(lessonPath);
      } catch {
        continue;
      }

      const relativePath = normalizeRelative(path.relative(trimmedRoot, lessonPath));
      items.push({
        path: lessonPath,
        relativePath,
        student: studentName,
        name: lessonDir.name,
        updatedAt: lessonStat.mtime.toISOString(),
      });
    }
  }

  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    root: trimmedRoot,
    exists: true,
    items: items.slice(0, safeLimit),
  };
}

function normalizeRelative(value: string): string {
  return value.replaceAll('\\', '/');
}

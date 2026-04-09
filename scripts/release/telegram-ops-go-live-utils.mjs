import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const DEFAULT_ARTIFACT_DIR = path.join(REPO_ROOT, 'tmp', 'telegram-ops-go-live');

export function normalizeEnvValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export function parseBool(value, fallback = false) {
  const normalized = normalizeEnvValue(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function stripWrappingQuotes(value) {
  if (value.length < 2) {
    return value;
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseDotEnvContent(content) {
  const entries = new Map();
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (!key || key.includes(' ')) {
      continue;
    }
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());
    entries.set(key, value);
  }
  return entries;
}

export async function loadEnvFromFiles(args = {}) {
  const files = Array.isArray(args.files) ? args.files : ['.env.batch-backend', '.env'];
  const env = {
    ...(args.baseEnv ?? process.env),
  };
  const cwd = args.cwd ?? REPO_ROOT;

  for (const file of files) {
    const absolutePath = path.resolve(cwd, file);
    try {
      const content = await readFile(absolutePath, 'utf8');
      const parsed = parseDotEnvContent(content);
      for (const [key, value] of parsed.entries()) {
        if (!Object.hasOwn(env, key) || env[key] === '') {
          env[key] = value;
        }
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }

  return env;
}

export function truncateText(value, maxLength = 4000) {
  if (typeof value !== 'string') {
    return '';
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
}

export async function writeJsonArtifact(filePath, payload) {
  const targetPath = path.resolve(filePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return targetPath;
}

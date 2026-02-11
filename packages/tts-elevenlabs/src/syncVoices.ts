import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigurationError } from '@esl-pipeline/contracts';
import { getElevenClient } from './eleven.js';

interface VoiceRow {
  id: string;
  name: string;
  category?: string | null;
  labels?: Record<string, string | boolean | number>;
  preview_url?: string | null;
}

export const DEFAULT_VOICES_OUT = 'packages/orchestrator/configs/elevenlabs.voices.json';
const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findWorkspaceRoot(startDir: string): Promise<string | null> {
  let current = resolve(startDir);
  while (true) {
    if (await pathExists(join(current, WORKSPACE_MARKER))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function resolveDefaultOutPath(): Promise<string> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = [
    await findWorkspaceRoot(process.cwd()),
    await findWorkspaceRoot(moduleDir),
    await findWorkspaceRoot(resolve(moduleDir, '..', '..')),
    await findWorkspaceRoot(resolve(moduleDir, '..', '..', '..')),
    await findWorkspaceRoot(resolve(moduleDir, '..', '..', '..', '..')),
  ].find((root): root is string => typeof root === 'string' && root.length > 0);
  if (!workspaceRoot) {
    throw new ConfigurationError(
      `Unable to resolve workspace root for default voices output path "${DEFAULT_VOICES_OUT}". ` +
        `Pass an explicit --out path or run this command from the repository workspace.`,
    );
  }

  const abs = resolve(workspaceRoot, DEFAULT_VOICES_OUT);
  const normalizedAbs = normalize(abs);
  const normalizedRoot = normalize(resolve(workspaceRoot));
  const normalizedPrefix = `${normalizedRoot}${process.platform === 'win32' ? '\\' : '/'}`;
  if (!(normalizedAbs === normalizedRoot || normalizedAbs.startsWith(normalizedPrefix))) {
    throw new ConfigurationError(
      `Resolved default voices output path escapes workspace root: ${normalizedAbs}. ` +
        `Use --out to provide an explicit safe destination.`,
    );
  }
  return abs;
}

export async function syncVoices(outPath = DEFAULT_VOICES_OUT) {
  const client = getElevenClient();
  // SDK: voices.getAll() returns list of voices the key can use
  const list = (await client.voices.getAll()) as unknown;
  interface RawVoice {
    voiceId?: string;
    voice_id?: string;
    id?: string;
    name: string;
    category?: string | null;
    labels?: Record<string, string | boolean | number>;
    preview_url?: string | null;
  }

  const rawVoices = (() => {
    if (!list || typeof list !== 'object') return [];
    const maybeVoices = (list as { voices?: unknown }).voices;
    return Array.isArray(maybeVoices) ? (maybeVoices as RawVoice[]) : [];
  })();

  const rows: VoiceRow[] = rawVoices.map((v) => ({
    id: v.voiceId ?? v.voice_id ?? v.id ?? '',
    name: v.name,
    category: v.category ?? null,
    labels: v.labels ?? {},
    preview_url: v.preview_url ?? null,
  }));

  const requestedOut = outPath.trim();
  if (!requestedOut) {
    throw new ConfigurationError('Voice catalog output path cannot be empty.');
  }
  const usesDefault = normalize(requestedOut) === normalize(DEFAULT_VOICES_OUT);
  const abs = usesDefault ? await resolveDefaultOutPath() : resolve(requestedOut);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify({ voices: rows }, null, 2), 'utf8');
  return { count: rows.length, outPath: abs };
}

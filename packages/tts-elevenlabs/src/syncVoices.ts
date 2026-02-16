import { access, mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigurationError } from '@esl-pipeline/contracts';
import { getElevenClient } from './eleven.js';
import { buildVoiceCapabilitiesSnapshot } from './voiceCapabilities.js';

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
  let current = path.resolve(startDir);
  while (true) {
    if (await pathExists(path.join(current, WORKSPACE_MARKER))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function resolveDefaultOutPath(): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = [
    await findWorkspaceRoot(process.cwd()),
    await findWorkspaceRoot(moduleDir),
    await findWorkspaceRoot(path.resolve(moduleDir, '..', '..')),
    await findWorkspaceRoot(path.resolve(moduleDir, '..', '..', '..')),
    await findWorkspaceRoot(path.resolve(moduleDir, '..', '..', '..', '..')),
  ].find((root): root is string => typeof root === 'string' && root.length > 0);
  if (!workspaceRoot) {
    throw new ConfigurationError(
      `Unable to resolve workspace root for default voices output path "${DEFAULT_VOICES_OUT}". ` +
        `Pass an explicit --out path or run this command from the repository workspace.`,
    );
  }

  const abs = path.resolve(workspaceRoot, DEFAULT_VOICES_OUT);
  const normalizedAbs = path.normalize(abs);
  const normalizedRoot = path.normalize(path.resolve(workspaceRoot));
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
    name?: string;
    category?: string | null;
    labels?: Record<string, unknown>;
    useCase?: string;
    verifiedLanguages?: { language?: string; locale?: string }[];
    previewUrl?: string | null;
    preview_url?: string | null;
  }

  const normalizeLabels = (voice: RawVoice): Record<string, string | boolean | number> => {
    const labels: Record<string, string | boolean | number> = {};
    for (const [key, value] of Object.entries(voice.labels ?? {})) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        labels[key] = value;
      }
    }

    if (!labels.use_case && typeof voice.useCase === 'string' && voice.useCase.trim().length > 0) {
      labels.use_case = voice.useCase.trim().toLowerCase();
    }

    if (!labels.language && Array.isArray(voice.verifiedLanguages)) {
      const lang = voice.verifiedLanguages
        .map((entry) => (entry.language ?? entry.locale ?? '').trim().toLowerCase())
        .find((entry) => entry.length > 0);
      if (lang) labels.language = lang;
    }

    return labels;
  };

  const rawVoices = (() => {
    if (!list || typeof list !== 'object') return [];
    const maybeVoices = (list as { voices?: unknown }).voices;
    return Array.isArray(maybeVoices) ? (maybeVoices as RawVoice[]) : [];
  })();

  const rows: VoiceRow[] = [];
  for (const voice of rawVoices) {
    const id = (voice.voiceId ?? voice.voice_id ?? voice.id ?? '').trim();
    const name = (voice.name ?? '').trim();
    if (!id || !name) continue;
    rows.push({
      id,
      name,
      category: voice.category ?? null,
      labels: normalizeLabels(voice),
      preview_url: voice.previewUrl ?? voice.preview_url ?? null,
    });
  }
  rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id),
  );
  const generatedAt = new Date().toISOString();
  const capabilities = buildVoiceCapabilitiesSnapshot(
    rows.map((row) => ({
      labels: row.labels,
      useCase: typeof row.labels?.use_case === 'string' ? row.labels.use_case : undefined,
    })),
    generatedAt,
  );

  const requestedOut = outPath.trim();
  if (!requestedOut) {
    throw new ConfigurationError('Voice catalog output path cannot be empty.');
  }
  const usesDefault = path.normalize(requestedOut) === path.normalize(DEFAULT_VOICES_OUT);
  const abs = usesDefault ? await resolveDefaultOutPath() : path.resolve(requestedOut);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify({ generatedAt, capabilities, voices: rows }, null, 2), 'utf8');
  return { count: rows.length, outPath: abs };
}

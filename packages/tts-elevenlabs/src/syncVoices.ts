import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { getElevenClient } from './eleven.js';

interface VoiceRow {
  id: string;
  name: string;
  category?: string | null;
  labels?: Record<string, string | boolean | number>;
  preview_url?: string | null;
}

export async function syncVoices(outPath = 'configs/elevenlabs.voices.json') {
  const client = getElevenClient();
  // SDK: voices.getAll() returns list of voices the key can use
  const list = await client.voices.getAll();
  type RawVoice = {
    voiceId?: string;
    voice_id?: string;
    id?: string;
    name: string;
    category?: string | null;
    labels?: Record<string, string | boolean | number>;
    preview_url?: string | null;
  };

  const rows: VoiceRow[] = (list.voices ?? []).map((v: RawVoice) => ({
    id: v.voiceId ?? v.voice_id ?? v.id ?? '',
    name: v.name,
    category: v.category ?? null,
    labels: v.labels ?? {},
    preview_url: v.preview_url ?? null,
  }));
  const abs = resolve(outPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify({ voices: rows }, null, 2), 'utf8');
  return { count: rows.length, outPath: abs };
}

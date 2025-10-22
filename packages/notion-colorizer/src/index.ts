import { readFile } from 'node:fs/promises';

export type ApplyHeadingPresetResult = {
  applied: boolean;
  counts: {
    h2: number;
    h3: number;
    toggles: number;
  };
  preset?: string;
};

async function readPresetsFile(presetsPath?: string): Promise<Record<string, unknown> | null> {
  if (!presetsPath) return null;
  try {
    const contents = await readFile(presetsPath, 'utf8');
    return JSON.parse(contents) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function applyHeadingPreset(
  pageId: string,
  presetName: string,
  presetsPath?: string
): Promise<ApplyHeadingPresetResult> {
  await readPresetsFile(presetsPath);
  if (!pageId.trim()) throw new Error('pageId is required');
  if (!presetName.trim()) throw new Error('presetName is required');

  return {
    applied: false,
    counts: { h2: 0, h3: 0, toggles: 0 },
    preset: presetName
  };
}

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import * as googleProvider from '@esl-pipeline/tts-provider-google';

import { materializePromptTemplateWithCapabilities } from '../src/application/prompt-voice-capabilities.js';

const TEMPLATE = [
  'Header',
  '```yaml',
  '# CAPABILITY SNAPSHOT (injected dynamically per voice catalog refresh)',
  'role: [narrator, teacher, student, system]',
  'gender: [male, female, neutral, child]',
  'age: [child, teen, young, adult, middle_aged, senior, universal]',
  'accent: [<provider-backed values>]',
  'style: [<provider-backed values>]',
  '```',
].join('\n');

async function writeElevenCatalog(filePath: string) {
  await fs.writeFile(
    filePath,
    JSON.stringify({
      generatedAt: '2026-01-05T00:00:00.000Z',
      capabilities: {
        generatedAt: '2026-01-05T00:00:00.000Z',
        role: ['narrator', 'teacher', 'student', 'system'],
        gender: ['male', 'female', 'neutral', 'child'],
        age: ['child', 'teen', 'young', 'adult', 'middle_aged', 'senior', 'universal'],
        accent: ['american', 'british'],
        style: ['conversational', 'professional'],
      },
      voices: [],
    }),
    'utf8',
  );
}

describe('application/prompt-voice-capabilities', () => {
  it('merges ElevenLabs and Google capability snapshots', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-voice-cap-merge-'));
    const voicesPath = path.join(dir, 'voices.json');
    await writeElevenCatalog(voicesPath);

    const previousVoicesPath = process.env.ELEVENLABS_VOICES_PATH;
    process.env.ELEVENLABS_VOICES_PATH = voicesPath;
    vi.spyOn(googleProvider, 'loadGoogleVoicesCatalog').mockResolvedValue({
      generatedAt: '2026-01-06T00:00:00.000Z',
      capabilities: {
        generatedAt: '2026-01-06T00:00:00.000Z',
        role: ['narrator', 'teacher', 'student', 'system'],
        gender: ['male', 'female', 'neutral'],
        age: ['child', 'teen', 'young', 'adult', 'middle_aged', 'senior', 'universal'],
        accent: ['australian'],
        style: ['chirp3_hd'],
      },
      voices: [],
    });

    try {
      const result = await materializePromptTemplateWithCapabilities({
        templateId: 'hw_prompt_v4-5_voice-aligned.md',
        templateContent: TEMPLATE,
      });

      expect(result.capabilitiesSnapshot?.accent).toEqual(['american', 'australian', 'british']);
      expect(result.capabilitiesSnapshot?.style).toEqual([
        'chirp3_hd',
        'conversational',
        'professional',
      ]);
      expect(result.materializedTemplate).toContain('accent: [american, australian, british]');
    } finally {
      if (previousVoicesPath === undefined) {
        delete process.env.ELEVENLABS_VOICES_PATH;
      } else {
        process.env.ELEVENLABS_VOICES_PATH = previousVoicesPath;
      }
      vi.restoreAllMocks();
    }
  });

  it('degrades to single-provider snapshot when Google catalog is unavailable', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-voice-cap-single-'));
    const voicesPath = path.join(dir, 'voices.json');
    await writeElevenCatalog(voicesPath);

    const previousVoicesPath = process.env.ELEVENLABS_VOICES_PATH;
    process.env.ELEVENLABS_VOICES_PATH = voicesPath;
    vi.spyOn(googleProvider, 'loadGoogleVoicesCatalog').mockRejectedValue(new Error('adc missing'));

    try {
      const result = await materializePromptTemplateWithCapabilities({
        templateId: 'hw_prompt_v4-5_voice-aligned.md',
        templateContent: TEMPLATE,
      });

      expect(result.capabilitiesSnapshot?.accent).toEqual(['american', 'british']);
      expect(result.materializedTemplate).toContain('accent: [american, british]');
    } finally {
      if (previousVoicesPath === undefined) {
        delete process.env.ELEVENLABS_VOICES_PATH;
      } else {
        process.env.ELEVENLABS_VOICES_PATH = previousVoicesPath;
      }
      vi.restoreAllMocks();
    }
  });
});

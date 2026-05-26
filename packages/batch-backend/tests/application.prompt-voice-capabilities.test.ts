import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import * as elevenLabsProvider from '@esl-pipeline/tts-provider-elevenlabs';
import * as googleProvider from '@esl-pipeline/tts-provider-google';
import * as inworldProvider from '@esl-pipeline/tts-provider-inworld';

import { resolvePromptVoiceCapabilities } from '../src/application/prompt-voice-capabilities.js';

const CANONICAL_ELEVENLABS_VOICES_ENV = 'ESL_TTS_PROVIDER_ELEVENLABS_VOICES_PATH';
const RETIRED_ELEVENLABS_VOICES_ENV = ['ELEVENLABS', 'VOICES', 'PATH'].join('_');
const GOOGLE_CREDENTIALS_ENV = 'GOOGLE_APPLICATION_CREDENTIALS';
const CANONICAL_INWORLD_API_KEY_ENV = 'ESL_TTS_PROVIDER_INWORLD_API_KEY';
const INWORLD_API_KEY_ENV = 'INWORLD_API_KEY';

async function writeElevenCatalog(
  filePath: string,
  capabilities: {
    generatedAt?: string;
    accent: string[];
    style: string[];
  } = {
    accent: ['american', 'british'],
    style: ['conversational', 'professional'],
  },
) {
  const generatedAt = capabilities.generatedAt ?? '2026-01-05T00:00:00.000Z';
  await fs.writeFile(
    filePath,
    JSON.stringify({
      generatedAt,
      capabilities: {
        generatedAt,
        role: ['narrator', 'teacher', 'student', 'system'],
        gender: ['male', 'female', 'neutral', 'child'],
        age: ['child', 'teen', 'young', 'adult', 'middle_aged', 'senior', 'universal'],
        accent: capabilities.accent,
        style: capabilities.style,
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

    const previousVoicesPath = process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
    const previousGoogleCredentials = process.env[GOOGLE_CREDENTIALS_ENV];
    process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = voicesPath;
    process.env[GOOGLE_CREDENTIALS_ENV] = path.join(dir, 'mock-google-credentials.json');
    vi.spyOn(inworldProvider, 'loadInworldVoicesCatalog').mockRejectedValue(new Error('no key'));
    vi.spyOn(googleProvider, 'loadGoogleVoicesCatalog').mockResolvedValue({
      generatedAt: '2026-01-06T00:00:00.000Z',
      capabilities: {
        generatedAt: '2026-01-06T00:00:00.000Z',
        role: ['narrator', 'teacher', 'student', 'system'],
        gender: ['male', 'female', 'neutral'],
        age: ['child', 'teen', 'young', 'adult', 'middle_aged', 'senior', 'universal'],
        accent: ['australian'],
        style: ['chirp3_hd', 'calm', 'studio', 'casual', 'wavenet', 'neural2'],
      },
      voices: [],
    });

    try {
      const result = await resolvePromptVoiceCapabilities({
        templateId: 'hw_prompt_definitive.md',
      });

      expect(result.capabilitiesSnapshot?.accent).toEqual(['american', 'australian', 'british']);
      expect(result.capabilitiesSnapshot?.style).toEqual([
        'calm',
        'casual',
        'conversational',
        'professional',
      ]);
      expect(result.blockText).toContain('[VOICE_CAPABILITIES]');
      expect(result.blockText).toContain('generated_at: 2026-01-06T00:00:00.000Z');
      expect(result.blockText).toContain('accent: [american, australian, british]');
      expect(result.blockText).toContain('style: [calm, casual, conversational, professional]');
      expect(result.blockText).not.toContain('chirp3_hd');
      expect(result.blockText).not.toContain('studio');
      expect(result.blockText).not.toContain('wavenet');
      expect(result.blockText).not.toContain('neural2');
      expect(result.blockText).not.toContain('# CAPABILITY SNAPSHOT');
      expect(result.blockText).not.toContain('```');
      expect(result.blockText).not.toContain('<provider-backed values>');
    } finally {
      if (previousVoicesPath === undefined) {
        delete process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
      } else {
        process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = previousVoicesPath;
      }
      if (previousGoogleCredentials === undefined) {
        delete process.env[GOOGLE_CREDENTIALS_ENV];
      } else {
        process.env[GOOGLE_CREDENTIALS_ENV] = previousGoogleCredentials;
      }
      vi.restoreAllMocks();
    }
  });

  it('uses canonical ElevenLabs provider catalog env and ignores the retired legacy env', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-voice-cap-canonical-'));
    const canonicalVoicesPath = path.join(dir, 'canonical-voices.json');
    const legacyVoicesPath = path.join(dir, 'legacy-voices.json');
    await writeElevenCatalog(canonicalVoicesPath, {
      generatedAt: '2026-01-07T00:00:00.000Z',
      accent: ['canonical_accent'],
      style: ['canonical_style'],
    });
    await writeElevenCatalog(legacyVoicesPath, {
      generatedAt: '2026-01-08T00:00:00.000Z',
      accent: ['legacy_accent'],
      style: ['legacy_style'],
    });

    const previousCanonicalPath = process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
    const previousRetiredPath = process.env[RETIRED_ELEVENLABS_VOICES_ENV];
    process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = canonicalVoicesPath;
    process.env[RETIRED_ELEVENLABS_VOICES_ENV] = legacyVoicesPath;
    vi.spyOn(googleProvider, 'loadGoogleVoicesCatalog').mockRejectedValue(new Error('adc missing'));
    vi.spyOn(inworldProvider, 'loadInworldVoicesCatalog').mockRejectedValue(new Error('no key'));

    try {
      const result = await resolvePromptVoiceCapabilities({
        templateId: 'hw_prompt_definitive.md',
      });

      expect(result.capabilitiesSnapshot?.generatedAt).toBe('2026-01-07T00:00:00.000Z');
      expect(result.capabilitiesSnapshot?.accent).toEqual(['canonical_accent']);
      expect(result.capabilitiesSnapshot?.style).toEqual(['canonical_style']);
      expect(result.blockText).toContain('accent: [canonical_accent]');
      expect(result.blockText).not.toContain('legacy_accent');
      expect(result.blockText.length).toBeLessThan(2000);
    } finally {
      if (previousCanonicalPath === undefined) {
        delete process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
      } else {
        process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = previousCanonicalPath;
      }
      if (previousRetiredPath === undefined) {
        delete process.env[RETIRED_ELEVENLABS_VOICES_ENV];
      } else {
        process.env[RETIRED_ELEVENLABS_VOICES_ENV] = previousRetiredPath;
      }
      vi.restoreAllMocks();
    }
  });

  it('degrades to single-provider snapshot when Google catalog is unavailable', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-voice-cap-single-'));
    const voicesPath = path.join(dir, 'voices.json');
    await writeElevenCatalog(voicesPath);

    const previousVoicesPath = process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
    process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = voicesPath;
    vi.spyOn(googleProvider, 'loadGoogleVoicesCatalog').mockRejectedValue(new Error('adc missing'));
    vi.spyOn(inworldProvider, 'loadInworldVoicesCatalog').mockRejectedValue(new Error('no key'));

    try {
      const result = await resolvePromptVoiceCapabilities({
        templateId: 'hw_prompt_definitive.md',
      });

      expect(result.capabilitiesSnapshot?.accent).toEqual(['american', 'british']);
      expect(result.blockText).toContain('accent: [american, british]');
    } finally {
      if (previousVoicesPath === undefined) {
        delete process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
      } else {
        process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = previousVoicesPath;
      }
      vi.restoreAllMocks();
    }
  });

  it('fails when no provider capability snapshot is available', async () => {
    const previousVoicesPath = process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
    const previousGoogleCredentials = process.env[GOOGLE_CREDENTIALS_ENV];
    const previousCanonicalInworldApiKey = process.env[CANONICAL_INWORLD_API_KEY_ENV];
    const previousInworldApiKey = process.env[INWORLD_API_KEY_ENV];
    delete process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
    delete process.env[GOOGLE_CREDENTIALS_ENV];
    delete process.env[CANONICAL_INWORLD_API_KEY_ENV];
    delete process.env[INWORLD_API_KEY_ENV];
    vi.spyOn(elevenLabsProvider, 'loadVoicesCatalog').mockRejectedValue(
      new Error('catalog missing'),
    );
    vi.spyOn(googleProvider, 'loadGoogleVoicesCatalog').mockRejectedValue(new Error('adc missing'));
    vi.spyOn(inworldProvider, 'loadInworldVoicesCatalog').mockResolvedValue({
      generatedAt: '2026-01-09T00:00:00.000Z',
      capabilities: {
        generatedAt: '2026-01-09T00:00:00.000Z',
        role: ['narrator', 'teacher', 'student', 'system'],
        gender: ['male', 'female', 'neutral'],
        age: ['child', 'teen', 'young', 'adult', 'middle_aged', 'senior', 'universal'],
        accent: ['american'],
        style: ['inworld-tts-2'],
      },
      voices: [],
    });

    try {
      await expect(
        resolvePromptVoiceCapabilities({
          templateId: 'hw_prompt_definitive.md',
        }),
      ).rejects.toThrow(/Voice-aligned prompt packages require a voice capabilities snapshot/);
    } finally {
      if (previousVoicesPath === undefined) {
        delete process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
      } else {
        process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = previousVoicesPath;
      }
      if (previousGoogleCredentials === undefined) {
        delete process.env[GOOGLE_CREDENTIALS_ENV];
      } else {
        process.env[GOOGLE_CREDENTIALS_ENV] = previousGoogleCredentials;
      }
      if (previousCanonicalInworldApiKey === undefined) {
        delete process.env[CANONICAL_INWORLD_API_KEY_ENV];
      } else {
        process.env[CANONICAL_INWORLD_API_KEY_ENV] = previousCanonicalInworldApiKey;
      }
      if (previousInworldApiKey === undefined) {
        delete process.env[INWORLD_API_KEY_ENV];
      } else {
        process.env[INWORLD_API_KEY_ENV] = previousInworldApiKey;
      }
      vi.restoreAllMocks();
    }
  });

  it('merges Inworld capability snapshot when an Inworld API key is configured', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-voice-cap-inworld-'));
    const voicesPath = path.join(dir, 'voices.json');
    await writeElevenCatalog(voicesPath);

    const previousVoicesPath = process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
    const previousCanonicalInworldApiKey = process.env[CANONICAL_INWORLD_API_KEY_ENV];
    process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = voicesPath;
    process.env[CANONICAL_INWORLD_API_KEY_ENV] = 'test-basic-key';
    vi.spyOn(googleProvider, 'loadGoogleVoicesCatalog').mockRejectedValue(new Error('adc missing'));
    vi.spyOn(inworldProvider, 'loadInworldVoicesCatalog').mockResolvedValue({
      generatedAt: '2026-01-09T00:00:00.000Z',
      capabilities: {
        generatedAt: '2026-01-09T00:00:00.000Z',
        role: ['narrator', 'teacher', 'student', 'system'],
        gender: ['male', 'female', 'neutral'],
        age: ['child', 'teen', 'young', 'adult', 'middle_aged', 'senior', 'universal'],
        accent: ['american'],
        style: ['inworld-tts-2', 'inworld-tts-1.5-max', 'inworld-tts-1.5-mini'],
      },
      voices: [],
    });

    try {
      const result = await resolvePromptVoiceCapabilities({
        templateId: 'hw_prompt_definitive.md',
      });

      expect(result.capabilitiesSnapshot?.style).toContain('inworld-tts-2');
      expect(result.capabilitiesSnapshot?.style).toContain('inworld-tts-1.5-max');
      expect(result.capabilitiesSnapshot?.style).toContain('inworld-tts-1.5-mini');
      expect(result.blockText).toContain('inworld-tts-2');
    } finally {
      if (previousVoicesPath === undefined) {
        delete process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
      } else {
        process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = previousVoicesPath;
      }
      if (previousCanonicalInworldApiKey === undefined) {
        delete process.env[CANONICAL_INWORLD_API_KEY_ENV];
      } else {
        process.env[CANONICAL_INWORLD_API_KEY_ENV] = previousCanonicalInworldApiKey;
      }
      vi.restoreAllMocks();
    }
  });
});

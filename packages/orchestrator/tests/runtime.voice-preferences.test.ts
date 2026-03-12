import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyVoicePreferences, resetVoiceCatalogCache } from '../src/runtime/voice-preferences.js';

const ttsMocks = vi.hoisted(() => ({
  loadVoicesCatalog: vi.fn(),
}));

vi.mock('@esl-pipeline/tts-core', async () => {
  const actual =
    await vi.importActual<typeof import('@esl-pipeline/tts-core')>('@esl-pipeline/tts-core');
  return {
    ...actual,
    loadVoicesCatalog: ttsMocks.loadVoicesCatalog,
  };
});

describe('runtime/voice-preferences', () => {
  afterEach(() => {
    resetVoiceCatalogCache();
    ttsMocks.loadVoicesCatalog.mockReset();
  });

  it('does nothing when no voice preference tokens are provided', async () => {
    const flags = {};
    await applyVoicePreferences(flags);
    expect(ttsMocks.loadVoicesCatalog).not.toHaveBeenCalled();
  });

  it('resolves voiceId token and fills accent when available', async () => {
    ttsMocks.loadVoicesCatalog.mockResolvedValue({
      voices: [{ id: 'voice-1', name: 'Narrator', labels: { accent: 'american' } }],
    });
    const flags = { voiceId: 'Narrator' };
    await applyVoicePreferences(flags);
    expect(flags).toEqual({ voiceId: 'voice-1', accentPreference: 'american' });
  });

  it('resolves accent token to a voice id', async () => {
    ttsMocks.loadVoicesCatalog.mockResolvedValue({
      voices: [{ id: 'voice-2', name: 'british', labels: { accent: 'british' } }],
    });
    const flags = { accentPreference: 'british' };
    await applyVoicePreferences(flags);
    expect(flags).toEqual({ accentPreference: 'british', voiceId: 'voice-2' });
  });

  it('falls back to empty catalog when voice catalog load fails', async () => {
    ttsMocks.loadVoicesCatalog.mockRejectedValue(new Error('network down'));
    const flags = { voiceId: 'Narrator' };
    await expect(applyVoicePreferences(flags)).resolves.toBeUndefined();
    expect(flags.voiceId).toBe('Narrator');
  });
});

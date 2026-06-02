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

  it('loads a provider-scoped catalog when provider is supplied', async () => {
    ttsMocks.loadVoicesCatalog.mockResolvedValue({
      voices: [{ id: 'google-voice-1', name: 'Narrator', labels: { accent: 'american' } }],
    });
    const flags = { voiceId: 'Narrator', provider: 'google' as const };
    await applyVoicePreferences(flags);
    expect(ttsMocks.loadVoicesCatalog).toHaveBeenCalledWith('google');
    expect(flags).toEqual({
      voiceId: 'google-voice-1',
      accentPreference: 'american',
      provider: 'google',
    });
  });

  it('resolves accent token to a voice id', async () => {
    ttsMocks.loadVoicesCatalog.mockResolvedValue({
      voices: [{ id: 'voice-2', name: 'Narrator', labels: { accent: 'british' } }],
    });
    const flags = { accentPreference: 'british' };
    await applyVoicePreferences(flags);
    expect(flags).toEqual({ accentPreference: 'british', voiceId: 'voice-2' });
  });

  it('resolves accent-only preferences from voice labels when the accent is not a voice name', async () => {
    ttsMocks.loadVoicesCatalog.mockResolvedValue({
      voices: [
        { id: 'voice-3', name: 'Narrator', labels: { accent: 'american' } },
        { id: 'voice-4', name: 'Guide', labels: { accent: 'british' } },
      ],
    });
    const flags = { accentPreference: 'american' };
    await applyVoicePreferences(flags);
    expect(flags).toEqual({ accentPreference: 'american', voiceId: 'voice-3' });
  });

  it('keeps accent-only preferences as provider guidance when concrete resolution is disabled', async () => {
    const flags = { accentPreference: 'american' };

    await applyVoicePreferences(flags, { resolveAccentToVoiceId: false });

    expect(flags).toEqual({ accentPreference: 'american' });
    expect(ttsMocks.loadVoicesCatalog).not.toHaveBeenCalled();
  });

  it('falls back to empty catalog when voice catalog load fails', async () => {
    ttsMocks.loadVoicesCatalog.mockRejectedValue(new Error('network down'));
    const flags = { voiceId: 'Narrator' };
    await expect(applyVoicePreferences(flags)).resolves.toBeUndefined();
    expect(flags.voiceId).toBe('Narrator');
  });

  it('can fall back to the first provider-scoped catalog voice when requested', async () => {
    ttsMocks.loadVoicesCatalog.mockResolvedValue({
      voices: [
        { id: 'google-voice-1', name: 'Achernar', labels: { accent: 'american' } },
        { id: 'google-voice-2', name: 'Charon', labels: { accent: 'british' } },
      ],
    });
    const flags = { provider: 'google' as const };
    await applyVoicePreferences(flags, { fallbackToFirstCatalogVoice: true });
    expect(ttsMocks.loadVoicesCatalog).toHaveBeenCalledWith('google');
    expect(flags).toEqual({
      provider: 'google',
      voiceId: 'google-voice-1',
      accentPreference: 'american',
    });
  });
});

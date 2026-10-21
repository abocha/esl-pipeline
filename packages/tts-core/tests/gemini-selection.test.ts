import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildDefaultTtsModelByProvider,
  getTtsModelCapabilities,
  parseTtsProviderId,
  validateTtsSelection,
} from '../src/index.js';

afterEach(() => vi.unstubAllEnvs());

describe('Gemini Cloud selection identity', () => {
  it('admits Gemini separately from Chirp and defaults only its own lane to Flash-Lite', () => {
    vi.stubEnv('ESL_TTS_PROVIDER_GEMINI_MODEL', '');
    vi.stubEnv('ESL_TTS_PROVIDER_GOOGLE_MODEL', '');
    expect(parseTtsProviderId(' GEMINI ')).toBe('gemini');
    expect(buildDefaultTtsModelByProvider(['google', 'gemini'])).toEqual({
      google: 'chirp3_hd',
      gemini: 'gemini-3.8-flash-lite-tts',
    });
    expect(() =>
      validateTtsSelection({ provider: 'google', model: 'gemini-3.8-flash-tts' }),
    ).toThrow('not supported');
    expect(() => validateTtsSelection({ provider: 'gemini', model: 'chirp3_hd' })).toThrow(
      'not supported',
    );
  });

  it.each(['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'] as const)(
    'uses plain identity planning for %s',
    (model) => {
      expect(getTtsModelCapabilities('gemini', model)).toEqual({ planningMode: 'identity' });
    },
  );
});

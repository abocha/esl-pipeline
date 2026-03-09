import { describe, expect, it } from 'vitest';

import { normalizeStoredTtsProvider } from '../src/domain/settings-repository.js';

describe('domain/settings-repository', () => {
  describe('normalizeStoredTtsProvider', () => {
    it('keeps supported providers unchanged', () => {
      expect(normalizeStoredTtsProvider('elevenlabs', 'user-1')).toBe('elevenlabs');
      expect(normalizeStoredTtsProvider('google', 'user-1')).toBe('google');
    });

    it('maps legacy providers to elevenlabs fallback', () => {
      expect(normalizeStoredTtsProvider('openai', 'user-1')).toBe('elevenlabs');
      expect(normalizeStoredTtsProvider('azure', 'user-1')).toBe('elevenlabs');
    });

    it('maps unknown providers to elevenlabs fallback', () => {
      expect(normalizeStoredTtsProvider('unknown-provider', 'user-1')).toBe('elevenlabs');
    });
  });
});

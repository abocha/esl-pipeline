import { describe, expect, it } from 'vitest';

import { normalizeStoredTtsProvider } from '../src/domain/settings-repository.js';

describe('domain/settings-repository', () => {
  describe('normalizeStoredTtsProvider', () => {
    it('keeps supported providers unchanged', () => {
      expect(normalizeStoredTtsProvider('elevenlabs', 'user-1')).toBe('elevenlabs');
      expect(normalizeStoredTtsProvider('google', 'user-1')).toBe('google');
    });

    it('maps non-canonical providers to elevenlabs fallback', () => {
      expect(normalizeStoredTtsProvider('openai', 'user-1')).toBe('elevenlabs');
      expect(normalizeStoredTtsProvider('azure', 'user-1')).toBe('elevenlabs');
      expect(normalizeStoredTtsProvider('unknown-provider', 'user-1')).toBe('elevenlabs');
    });
  });
});

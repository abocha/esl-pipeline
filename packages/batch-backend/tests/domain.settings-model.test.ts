// packages/batch-backend/tests/domain.settings-model.test.ts
import { describe, expect, it } from 'vitest';

import {
  getDefaultSettings,
  isValidTtsProvider,
  isValidTtsStrategy,
  sanitizeSettings,
  UserSettingsRecord,
  VALID_TTS_PROVIDERS,
  VALID_TTS_STRATEGIES,
} from '../src/domain/settings-model.js';

describe('domain/settings-model', () => {
  describe('isValidTtsProvider', () => {
    it('returns true for valid providers', () => {
      expect(isValidTtsProvider('elevenlabs')).toBe(true);
      expect(isValidTtsProvider('google')).toBe(true);
      expect(isValidTtsProvider('inworld')).toBe(true);
      expect(isValidTtsProvider('gemini')).toBe(true);
    });

    it('returns false for invalid providers', () => {
      expect(isValidTtsProvider('invalid')).toBe(false);
      expect(isValidTtsProvider('')).toBe(false);
      expect(isValidTtsProvider('ELEVENLABS')).toBe(false); // case-sensitive
    });
  });

  describe('isValidTtsStrategy', () => {
    it('returns true for valid strategies', () => {
      expect(isValidTtsStrategy('auto')).toBe(true);
      expect(isValidTtsStrategy('dialogue')).toBe(true);
      expect(isValidTtsStrategy('tts')).toBe(true);
    });

    it('returns false for invalid strategies', () => {
      expect(isValidTtsStrategy('invalid')).toBe(false);
      expect(isValidTtsStrategy('')).toBe(false);
      expect(isValidTtsStrategy('AUTO')).toBe(false); // case-sensitive
    });
  });

  describe('getDefaultSettings', () => {
    it('returns expected default values', () => {
      const defaults = getDefaultSettings();

      expect(defaults.elevenLabsKeyEncrypted).toBeNull();
      expect(defaults.ttsProvider).toBe('elevenlabs');
      expect(defaults.defaultPreset).toBe('b1-default');
      expect(defaults.defaultVoiceAccent).toBe('american');
      expect(defaults.defaultTtsStrategy).toBe('auto');
      expect(defaults.enableNotifications).toBe(true);
    });
  });

  describe('sanitizeSettings', () => {
    const mockRecord: UserSettingsRecord = {
      userId: 'user-123',
      elevenLabsKeyEncrypted: 'encrypted-key-data',
      ttsProvider: 'elevenlabs',
      defaultPreset: 'b2-intermediate',
      defaultVoiceAccent: 'british',
      defaultTtsStrategy: 'dialogue',
      enableNotifications: false,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    };

    it('includes boolean indicators for API keys', () => {
      const sanitized = sanitizeSettings(mockRecord);

      expect(sanitized.hasElevenLabsKey).toBe(true);
    });

    it('does not expose encrypted values', () => {
      const sanitized = sanitizeSettings(mockRecord);

      expect(sanitized).not.toHaveProperty('elevenLabsKeyEncrypted');
      expect(sanitized).not.toHaveProperty('id');
      expect(sanitized).not.toHaveProperty('userId');
    });

    it('includes all preference fields', () => {
      const sanitized = sanitizeSettings(mockRecord);

      expect(sanitized.ttsProvider).toBe('elevenlabs');
      expect(sanitized.defaultPreset).toBe('b2-intermediate');
      expect(sanitized.defaultVoiceAccent).toBe('british');
      expect(sanitized.defaultTtsStrategy).toBe('dialogue');
      expect(sanitized.enableNotifications).toBe(false);
    });

    it('includes timestamps', () => {
      const sanitized = sanitizeSettings(mockRecord);

      expect(sanitized.createdAt).toEqual(new Date('2024-01-01'));
      expect(sanitized.updatedAt).toEqual(new Date('2024-01-02'));
    });

    it('shows false for missing API keys', () => {
      const recordWithoutKeys: UserSettingsRecord = {
        ...mockRecord,
        elevenLabsKeyEncrypted: null,
      };

      const sanitized = sanitizeSettings(recordWithoutKeys);

      expect(sanitized.hasElevenLabsKey).toBe(false);
    });
  });

  describe('VALID_TTS_PROVIDERS', () => {
    it('contains expected providers', () => {
      expect(VALID_TTS_PROVIDERS).toContain('elevenlabs');
      expect(VALID_TTS_PROVIDERS).toContain('google');
      expect(VALID_TTS_PROVIDERS).toContain('inworld');
      expect(VALID_TTS_PROVIDERS).toContain('gemini');
      expect(VALID_TTS_PROVIDERS).toHaveLength(4);
    });
  });

  describe('VALID_TTS_STRATEGIES', () => {
    it('contains expected strategies', () => {
      expect(VALID_TTS_STRATEGIES).toContain('auto');
      expect(VALID_TTS_STRATEGIES).toContain('dialogue');
      expect(VALID_TTS_STRATEGIES).toContain('tts');
      expect(VALID_TTS_STRATEGIES).toHaveLength(3);
    });
  });
});

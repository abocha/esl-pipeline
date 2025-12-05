// packages/batch-backend/tests/domain.settings-model.test.ts
import { describe, expect, it } from 'vitest';

import {
  UserSettingsRecord,
  VALID_TTS_MODES,
  VALID_TTS_PROVIDERS,
  getDefaultSettings,
  isValidTtsMode,
  isValidTtsProvider,
  sanitizeSettings,
} from '../src/domain/settings-model.js';

describe('domain/settings-model', () => {
  describe('isValidTtsProvider', () => {
    it('returns true for valid providers', () => {
      expect(isValidTtsProvider('elevenlabs')).toBe(true);
      expect(isValidTtsProvider('openai')).toBe(true);
      expect(isValidTtsProvider('azure')).toBe(true);
      expect(isValidTtsProvider('google')).toBe(true);
    });

    it('returns false for invalid providers', () => {
      expect(isValidTtsProvider('invalid')).toBe(false);
      expect(isValidTtsProvider('')).toBe(false);
      expect(isValidTtsProvider('ELEVENLABS')).toBe(false); // case-sensitive
    });
  });

  describe('isValidTtsMode', () => {
    it('returns true for valid modes', () => {
      expect(isValidTtsMode('auto')).toBe(true);
      expect(isValidTtsMode('dialogue')).toBe(true);
      expect(isValidTtsMode('monologue')).toBe(true);
    });

    it('returns false for invalid modes', () => {
      expect(isValidTtsMode('invalid')).toBe(false);
      expect(isValidTtsMode('')).toBe(false);
      expect(isValidTtsMode('AUTO')).toBe(false); // case-sensitive
    });
  });

  describe('getDefaultSettings', () => {
    it('returns expected default values', () => {
      const defaults = getDefaultSettings();

      expect(defaults.elevenLabsKeyEncrypted).toBeNull();
      expect(defaults.notionTokenEncrypted).toBeNull();
      expect(defaults.ttsProvider).toBe('elevenlabs');
      expect(defaults.defaultPreset).toBe('b1-default');
      expect(defaults.defaultVoiceAccent).toBe('american');
      expect(defaults.defaultTtsMode).toBe('auto');
      expect(defaults.enableNotifications).toBe(true);
    });
  });

  describe('sanitizeSettings', () => {
    const mockRecord: UserSettingsRecord = {
      id: 'test-id',
      userId: 'user-123',
      elevenLabsKeyEncrypted: 'encrypted-key-data',
      notionTokenEncrypted: 'encrypted-token-data',
      ttsProvider: 'elevenlabs',
      defaultPreset: 'b2-intermediate',
      defaultVoiceAccent: 'british',
      defaultTtsMode: 'dialogue',
      enableNotifications: false,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    };

    it('includes boolean indicators for API keys', () => {
      const sanitized = sanitizeSettings(mockRecord);

      expect(sanitized.hasElevenLabsKey).toBe(true);
      expect(sanitized.hasNotionToken).toBe(true);
    });

    it('does not expose encrypted values', () => {
      const sanitized = sanitizeSettings(mockRecord);

      expect(sanitized).not.toHaveProperty('elevenLabsKeyEncrypted');
      expect(sanitized).not.toHaveProperty('notionTokenEncrypted');
      expect(sanitized).not.toHaveProperty('id');
      expect(sanitized).not.toHaveProperty('userId');
    });

    it('includes all preference fields', () => {
      const sanitized = sanitizeSettings(mockRecord);

      expect(sanitized.ttsProvider).toBe('elevenlabs');
      expect(sanitized.defaultPreset).toBe('b2-intermediate');
      expect(sanitized.defaultVoiceAccent).toBe('british');
      expect(sanitized.defaultTtsMode).toBe('dialogue');
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
        notionTokenEncrypted: null,
      };

      const sanitized = sanitizeSettings(recordWithoutKeys);

      expect(sanitized.hasElevenLabsKey).toBe(false);
      expect(sanitized.hasNotionToken).toBe(false);
    });
  });

  describe('VALID_TTS_PROVIDERS', () => {
    it('contains expected providers', () => {
      expect(VALID_TTS_PROVIDERS).toContain('elevenlabs');
      expect(VALID_TTS_PROVIDERS).toContain('openai');
      expect(VALID_TTS_PROVIDERS).toContain('azure');
      expect(VALID_TTS_PROVIDERS).toContain('google');
      expect(VALID_TTS_PROVIDERS).toHaveLength(4);
    });
  });

  describe('VALID_TTS_MODES', () => {
    it('contains expected modes', () => {
      expect(VALID_TTS_MODES).toContain('auto');
      expect(VALID_TTS_MODES).toContain('dialogue');
      expect(VALID_TTS_MODES).toContain('monologue');
      expect(VALID_TTS_MODES).toHaveLength(3);
    });
  });
});

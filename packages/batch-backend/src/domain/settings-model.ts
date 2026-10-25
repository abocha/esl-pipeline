// packages/batch-backend/src/domain/settings-model.ts
// Domain model for user settings (API keys and preferences).
import type { TtsProviderId, TtsStrategy } from '@esl-pipeline/contracts';
import { resolveDefaultTtsProvider } from '@esl-pipeline/tts-core';

/**
 * TTS provider type - aligned with currently supported runtime adapters.
 */
export type TtsProvider = TtsProviderId;

/**
 * TTS strategy for audio generation
 */
export type UserTtsStrategy = TtsStrategy;

/**
 * Database record representation of user settings
 */
export interface UserSettingsRecord {
  userId: string;
  // Encrypted API keys (raw encrypted values from DB)
  elevenLabsKeyEncrypted: string | null;
  // TTS provider
  ttsProvider: TtsProvider;
  // Preferences
  defaultPreset: string;
  defaultVoiceAccent: string;
  defaultTtsStrategy: UserTtsStrategy;
  enableNotifications: boolean;
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating or updating user settings
 */
export interface UserSettingsInput {
  // Plain text API keys (will be encrypted before storage)
  elevenLabsKey?: string | null;
  // TTS provider
  ttsProvider?: TtsProvider;
  // Preferences
  defaultPreset?: string;
  defaultVoiceAccent?: string;
  defaultTtsStrategy?: UserTtsStrategy;
  enableNotifications?: boolean;
}

/**
 * Sanitized output for API responses (no raw encrypted values)
 */
export interface UserSettingsOutput {
  // Masked indicators (true = has key, false = no key)
  hasElevenLabsKey: boolean;
  // TTS provider
  ttsProvider: TtsProvider;
  // Preferences
  defaultPreset: string;
  defaultVoiceAccent: string;
  defaultTtsStrategy: UserTtsStrategy;
  enableNotifications: boolean;
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Valid TTS providers
 */
export const VALID_TTS_PROVIDERS: TtsProvider[] = ['elevenlabs', 'google', 'inworld', 'gemini'];

/**
 * Valid TTS strategies
 */
export const VALID_TTS_STRATEGIES: UserTtsStrategy[] = ['auto', 'dialogue', 'tts'];

/**
 * Check if a string is a valid TTS provider
 */
export function isValidTtsProvider(provider: string): provider is TtsProvider {
  return VALID_TTS_PROVIDERS.includes(provider as TtsProvider);
}

/**
 * Check if a string is a valid TTS strategy
 */
export function isValidTtsStrategy(strategy: string): strategy is UserTtsStrategy {
  return VALID_TTS_STRATEGIES.includes(strategy as UserTtsStrategy);
}

/**
 * Convert a database record to a sanitized output (for API responses)
 */
export function sanitizeSettings(record: UserSettingsRecord): UserSettingsOutput {
  return {
    hasElevenLabsKey: record.elevenLabsKeyEncrypted !== null,
    ttsProvider: record.ttsProvider,
    defaultPreset: record.defaultPreset,
    defaultVoiceAccent: record.defaultVoiceAccent,
    defaultTtsStrategy: record.defaultTtsStrategy,
    enableNotifications: record.enableNotifications,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Default settings for new users
 */
export function getDefaultSettings(): Omit<
  UserSettingsRecord,
  'userId' | 'createdAt' | 'updatedAt'
> {
  return {
    elevenLabsKeyEncrypted: null,
    ttsProvider: resolveDefaultTtsProvider(),
    defaultPreset: 'b1-default',
    defaultVoiceAccent: 'american',
    defaultTtsStrategy: 'auto',
    enableNotifications: true,
  };
}

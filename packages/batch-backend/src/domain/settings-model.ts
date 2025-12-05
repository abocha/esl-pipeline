// packages/batch-backend/src/domain/settings-model.ts
// Domain model for user settings (API keys and preferences).

/**
 * TTS provider type - extensible for future providers
 */
export type TtsProvider = 'elevenlabs' | 'openai' | 'azure' | 'google';

/**
 * TTS mode for audio generation
 */
export type TtsMode = 'auto' | 'dialogue' | 'monologue';

/**
 * Database record representation of user settings
 */
export interface UserSettingsRecord {
  id: string;
  userId: string;
  // Encrypted API keys (raw encrypted values from DB)
  elevenLabsKeyEncrypted: string | null;
  notionTokenEncrypted: string | null;
  // TTS provider
  ttsProvider: TtsProvider;
  // Preferences
  defaultPreset: string;
  defaultVoiceAccent: string;
  defaultTtsMode: TtsMode;
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
  notionToken?: string | null;
  // TTS provider
  ttsProvider?: TtsProvider;
  // Preferences
  defaultPreset?: string;
  defaultVoiceAccent?: string;
  defaultTtsMode?: TtsMode;
  enableNotifications?: boolean;
}

/**
 * Sanitized output for API responses (no raw encrypted values)
 */
export interface UserSettingsOutput {
  // Masked indicators (true = has key, false = no key)
  hasElevenLabsKey: boolean;
  hasNotionToken: boolean;
  // TTS provider
  ttsProvider: TtsProvider;
  // Preferences
  defaultPreset: string;
  defaultVoiceAccent: string;
  defaultTtsMode: TtsMode;
  enableNotifications: boolean;
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Valid TTS providers
 */
export const VALID_TTS_PROVIDERS: TtsProvider[] = ['elevenlabs', 'openai', 'azure', 'google'];

/**
 * Valid TTS modes
 */
export const VALID_TTS_MODES: TtsMode[] = ['auto', 'dialogue', 'monologue'];

/**
 * Check if a string is a valid TTS provider
 */
export function isValidTtsProvider(provider: string): provider is TtsProvider {
  return VALID_TTS_PROVIDERS.includes(provider as TtsProvider);
}

/**
 * Check if a string is a valid TTS mode
 */
export function isValidTtsMode(mode: string): mode is TtsMode {
  return VALID_TTS_MODES.includes(mode as TtsMode);
}

/**
 * Convert a database record to a sanitized output (for API responses)
 */
export function sanitizeSettings(record: UserSettingsRecord): UserSettingsOutput {
  return {
    hasElevenLabsKey: record.elevenLabsKeyEncrypted !== null,
    hasNotionToken: record.notionTokenEncrypted !== null,
    ttsProvider: record.ttsProvider,
    defaultPreset: record.defaultPreset,
    defaultVoiceAccent: record.defaultVoiceAccent,
    defaultTtsMode: record.defaultTtsMode,
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
  'id' | 'userId' | 'createdAt' | 'updatedAt'
> {
  return {
    elevenLabsKeyEncrypted: null,
    notionTokenEncrypted: null,
    ttsProvider: 'elevenlabs',
    defaultPreset: 'b1-default',
    defaultVoiceAccent: 'american',
    defaultTtsMode: 'auto',
    enableNotifications: true,
  };
}

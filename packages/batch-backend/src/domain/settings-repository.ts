// packages/batch-backend/src/domain/settings-repository.ts
// PostgreSQL-backed repository for UserSettingsRecord.
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { getEncryptionService } from '../infrastructure/encryption-service.js';
import { logger } from '../infrastructure/logger.js';
import {
  TtsMode,
  TtsProvider,
  UserSettingsInput,
  UserSettingsRecord,
  getDefaultSettings,
} from './settings-model.js';

/**
 * PostgreSQL row structure for user_settings table
 */
interface UserSettingsRow {
  id: string;
  user_id: string;
  elevenlabs_key_encrypted: string | null;
  notion_token_encrypted: string | null;
  tts_provider: string;
  default_preset: string;
  default_voice_accent: string;
  default_tts_mode: string;
  enable_notifications: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Map database row to domain model
 */
function mapRowToSettings(row: UserSettingsRow): UserSettingsRecord {
  return {
    id: row.id,
    userId: row.user_id,
    elevenLabsKeyEncrypted: row.elevenlabs_key_encrypted,
    notionTokenEncrypted: row.notion_token_encrypted,
    ttsProvider: row.tts_provider as TtsProvider,
    defaultPreset: row.default_preset,
    defaultVoiceAccent: row.default_voice_accent,
    defaultTtsMode: row.default_tts_mode as TtsMode,
    enableNotifications: row.enable_notifications,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get user settings by user ID.
 * Returns null if no settings exist for the user.
 */
export async function getSettingsByUserId(userId: string): Promise<UserSettingsRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<UserSettingsRow>(
      `
      SELECT id, user_id, elevenlabs_key_encrypted, notion_token_encrypted,
             tts_provider, default_preset, default_voice_accent, default_tts_mode,
             enable_notifications, created_at, updated_at
      FROM user_settings
      WHERE user_id = $1
      `,
      [userId],
    );
    return result.rows[0];
  });

  return row ? mapRowToSettings(row) : null;
}

/**
 * Create default settings for a user.
 * Uses INSERT ON CONFLICT to safely handle concurrent requests.
 */
export async function createDefaultSettings(userId: string): Promise<UserSettingsRecord> {
  const id = randomUUID();
  const defaults = getDefaultSettings();

  const row = await withPgClient(async (client: PoolClient) => {
    // Use ON CONFLICT to handle race conditions - if another request already
    // inserted settings, just return the existing row without error
    const result = await client.query<UserSettingsRow>(
      `
      INSERT INTO user_settings (
        id, user_id, elevenlabs_key_encrypted, notion_token_encrypted,
        tts_provider, default_preset, default_voice_accent, default_tts_mode,
        enable_notifications
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id) DO UPDATE SET
        updated_at = user_settings.updated_at  -- No-op update to return the row
      RETURNING id, user_id, elevenlabs_key_encrypted, notion_token_encrypted,
                tts_provider, default_preset, default_voice_accent, default_tts_mode,
                enable_notifications, created_at, updated_at
      `,
      [
        id,
        userId,
        defaults.elevenLabsKeyEncrypted,
        defaults.notionTokenEncrypted,
        defaults.ttsProvider,
        defaults.defaultPreset,
        defaults.defaultVoiceAccent,
        defaults.defaultTtsMode,
        defaults.enableNotifications,
      ],
    );
    return result.rows[0]!;
  });

  logger.info('Created or retrieved default user settings', { userId });
  return mapRowToSettings(row);
}

/**
 * Upsert user settings (create if not exists, update if exists).
 * Encrypts API keys before storage.
 * Uses INSERT ON CONFLICT to safely handle concurrent requests.
 */
export async function upsertSettings(
  userId: string,
  input: UserSettingsInput,
): Promise<UserSettingsRecord> {
  const encryptionService = getEncryptionService();
  const defaults = getDefaultSettings();

  // Encrypt API keys if provided
  let elevenLabsKeyEncrypted: string | null | undefined;
  let notionTokenEncrypted: string | null | undefined;

  // Handle ElevenLabs key
  if (input.elevenLabsKey !== undefined) {
    elevenLabsKeyEncrypted =
      input.elevenLabsKey === null || input.elevenLabsKey === ''
        ? null
        : encryptionService.encrypt(input.elevenLabsKey);
  }

  // Handle Notion token
  if (input.notionToken !== undefined) {
    notionTokenEncrypted =
      input.notionToken === null || input.notionToken === ''
        ? null
        : encryptionService.encrypt(input.notionToken);
  }

  const row = await withPgClient(async (client: PoolClient) => {
    const id = randomUUID();

    // Use INSERT ON CONFLICT to atomically create or update settings
    // COALESCE with EXCLUDED values handles partial updates:
    // - If a field is provided in input, use the new value
    // - If not provided, keep the existing value (or default for new rows)
    const result = await client.query<UserSettingsRow>(
      `
      INSERT INTO user_settings (
        id, user_id, elevenlabs_key_encrypted, notion_token_encrypted,
        tts_provider, default_preset, default_voice_accent, default_tts_mode,
        enable_notifications
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id) DO UPDATE SET
        elevenlabs_key_encrypted = CASE 
          WHEN $10 THEN EXCLUDED.elevenlabs_key_encrypted 
          ELSE user_settings.elevenlabs_key_encrypted 
        END,
        notion_token_encrypted = CASE 
          WHEN $11 THEN EXCLUDED.notion_token_encrypted 
          ELSE user_settings.notion_token_encrypted 
        END,
        tts_provider = CASE 
          WHEN $12 THEN EXCLUDED.tts_provider 
          ELSE user_settings.tts_provider 
        END,
        default_preset = CASE 
          WHEN $13 THEN EXCLUDED.default_preset 
          ELSE user_settings.default_preset 
        END,
        default_voice_accent = CASE 
          WHEN $14 THEN EXCLUDED.default_voice_accent 
          ELSE user_settings.default_voice_accent 
        END,
        default_tts_mode = CASE 
          WHEN $15 THEN EXCLUDED.default_tts_mode 
          ELSE user_settings.default_tts_mode 
        END,
        enable_notifications = CASE 
          WHEN $16 THEN EXCLUDED.enable_notifications 
          ELSE user_settings.enable_notifications 
        END,
        updated_at = NOW()
      RETURNING id, user_id, elevenlabs_key_encrypted, notion_token_encrypted,
                tts_provider, default_preset, default_voice_accent, default_tts_mode,
                enable_notifications, created_at, updated_at
      `,
      [
        id,
        userId,
        // Values for INSERT (use input if provided, else defaults)
        elevenLabsKeyEncrypted ?? defaults.elevenLabsKeyEncrypted,
        notionTokenEncrypted ?? defaults.notionTokenEncrypted,
        input.ttsProvider ?? defaults.ttsProvider,
        input.defaultPreset ?? defaults.defaultPreset,
        input.defaultVoiceAccent ?? defaults.defaultVoiceAccent,
        input.defaultTtsMode ?? defaults.defaultTtsMode,
        input.enableNotifications ?? defaults.enableNotifications,
        // Boolean flags for CASE expressions (true = update this field)
        input.elevenLabsKey !== undefined,
        input.notionToken !== undefined,
        input.ttsProvider !== undefined,
        input.defaultPreset !== undefined,
        input.defaultVoiceAccent !== undefined,
        input.defaultTtsMode !== undefined,
        input.enableNotifications !== undefined,
      ],
    );
    return result.rows[0]!;
  });

  logger.info('User settings upserted', {
    userId,
    updatedFields: Object.keys(input).filter(
      (k) => input[k as keyof UserSettingsInput] !== undefined,
    ),
  });

  return mapRowToSettings(row);
}

/**
 * Get decrypted ElevenLabs API key for a user.
 * Returns null if no key is stored.
 */
export async function getDecryptedElevenLabsKey(userId: string): Promise<string | null> {
  const settings = await getSettingsByUserId(userId);
  if (!settings?.elevenLabsKeyEncrypted) {
    return null;
  }

  const encryptionService = getEncryptionService();
  return encryptionService.decrypt(settings.elevenLabsKeyEncrypted);
}

/**
 * Get decrypted Notion token for a user.
 * Returns null if no token is stored.
 */
export async function getDecryptedNotionToken(userId: string): Promise<string | null> {
  const settings = await getSettingsByUserId(userId);
  if (!settings?.notionTokenEncrypted) {
    return null;
  }

  const encryptionService = getEncryptionService();
  return encryptionService.decrypt(settings.notionTokenEncrypted);
}

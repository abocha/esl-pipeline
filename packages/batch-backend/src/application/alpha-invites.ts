import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { getDefaultSettings } from '../domain/settings-model.js';
import type { UserRecord } from '../domain/user-model.js';
import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';

export type AlphaInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface AlphaInviteRecord {
  id: string;
  email: string;
  emailNormalized: string;
  tokenHash: string;
  status: AlphaInviteStatus;
  expiresAt: Date;
  invitedByUserId: string | null;
  acceptedUserId: string | null;
  createdAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export type AlphaInviteListItem = Omit<AlphaInviteRecord, 'tokenHash'>;

interface AlphaInviteRow {
  id: string;
  email: string;
  email_normalized: string;
  token_hash: string;
  status: AlphaInviteStatus;
  expires_at: Date;
  invited_by_user_id: string | null;
  accepted_user_id: string | null;
  created_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

export interface RegisterInvitedUserParams {
  email: string;
  passwordHash: string;
  inviteToken: string;
}

export interface CreateInviteResult {
  invite: AlphaInviteRecord;
  token: string;
  url: string | null;
}

export class AlphaInviteError extends Error {
  status: number;
  code: string;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'AlphaInviteError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function buildInviteUrl(appUrl: string, token: string): string {
  const trimmed = appUrl.trim().replace(/\/+$/, '');
  return `${trimmed}/#invite=${encodeURIComponent(token)}`;
}

export function redactInviteForList(invite: AlphaInviteRecord): AlphaInviteListItem {
  const { tokenHash: _tokenHash, ...redacted } = invite;
  return redacted;
}

function mapInviteRow(row: AlphaInviteRow): AlphaInviteRecord {
  return {
    id: row.id,
    email: row.email,
    emailNormalized: row.email_normalized,
    tokenHash: row.token_hash,
    status: row.status,
    expiresAt: row.expires_at,
    invitedByUserId: row.invited_by_user_id,
    acceptedUserId: row.accepted_user_id,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

function mapUserRow(row: {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role as UserRecord['role'],
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

async function expirePendingInvites(client: PoolClient): Promise<void> {
  await client.query(
    `
    UPDATE alpha_invites
    SET status = 'expired'
    WHERE status = 'pending'
      AND expires_at <= NOW()
    `,
  );
}

export async function createAlphaInvite(params: {
  email: string;
  expiresAt: Date;
  appUrl?: string | null;
  invitedByUserId?: string | null;
}): Promise<CreateInviteResult> {
  const email = params.email.trim();
  const emailNormalized = normalizeInviteEmail(email);
  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const id = randomUUID();

  const invite = await withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await expirePendingInvites(client);
      const result = await client.query<AlphaInviteRow>(
        `
        INSERT INTO alpha_invites (
          id,
          email,
          email_normalized,
          token_hash,
          status,
          expires_at,
          invited_by_user_id
        )
        VALUES ($1, $2, $3, $4, 'pending', $5, $6)
        RETURNING *
        `,
        [id, email, emailNormalized, tokenHash, params.expiresAt, params.invitedByUserId ?? null],
      );
      await client.query('COMMIT');
      return mapInviteRow(result.rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });

  logger.info('Alpha invite created', {
    inviteId: invite.id,
    emailNormalized: invite.emailNormalized,
    expiresAt: invite.expiresAt.toISOString(),
  });

  return {
    invite,
    token,
    url: params.appUrl ? buildInviteUrl(params.appUrl, token) : null,
  };
}

export async function listAlphaInvites(): Promise<AlphaInviteListItem[]> {
  return withPgClient(async (client) => {
    await expirePendingInvites(client);
    const result = await client.query<AlphaInviteRow>(
      `
      SELECT *
      FROM alpha_invites
      ORDER BY created_at DESC, id DESC
      `,
    );
    return result.rows.map((row) => redactInviteForList(mapInviteRow(row)));
  });
}

export async function revokeAlphaInvite(email: string): Promise<AlphaInviteListItem | null> {
  const emailNormalized = normalizeInviteEmail(email);
  const row = await withPgClient(async (client) => {
    const result = await client.query<AlphaInviteRow>(
      `
      UPDATE alpha_invites
      SET status = 'revoked',
          revoked_at = NOW()
      WHERE email_normalized = $1
        AND status = 'pending'
      RETURNING *
      `,
      [emailNormalized],
    );
    return result.rows[0] ?? null;
  });
  return row ? redactInviteForList(mapInviteRow(row)) : null;
}

export async function registerInvitedUser(params: RegisterInvitedUserParams): Promise<UserRecord> {
  const emailNormalized = normalizeInviteEmail(params.email);
  const tokenHash = hashInviteToken(params.inviteToken);

  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await expirePendingInvites(client);

      const inviteResult = await client.query<AlphaInviteRow>(
        `
        SELECT *
        FROM alpha_invites
        WHERE token_hash = $1
        FOR UPDATE
        `,
        [tokenHash],
      );
      const invite = inviteResult.rows[0] ? mapInviteRow(inviteResult.rows[0]) : null;

      if (!invite || invite.status !== 'pending' || invite.emailNormalized !== emailNormalized) {
        throw new AlphaInviteError(
          'Invite is invalid, expired, or already used.',
          'invalid_invite',
          400,
        );
      }

      const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [
        emailNormalized,
      ]);
      if (existingUser.rows.length > 0) {
        throw new AlphaInviteError('User with this email already exists', 'email_exists', 409);
      }

      const userId = randomUUID();
      const workspaceId = randomUUID();
      const settingsId = randomUUID();
      const now = new Date();
      const workspaceName = `${emailNormalized.split('@')[0] || 'Alpha'} workspace`;
      const defaultSettings = getDefaultSettings();

      const userResult = await client.query(
        `
        INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, 'user', TRUE, $4, $4)
        RETURNING id, email, password_hash, role, is_active, created_at, updated_at, last_login_at
        `,
        [userId, emailNormalized, params.passwordHash, now],
      );

      await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [
        workspaceId,
        workspaceName,
      ]);
      await client.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [workspaceId, userId],
      );
      await client.query(`INSERT INTO workspace_business_settings (workspace_id) VALUES ($1)`, [
        workspaceId,
      ]);
      await client.query(
        `
        INSERT INTO user_settings (
          id,
          user_id,
          elevenlabs_key_encrypted,
          tts_provider,
          default_preset,
          default_voice_accent,
          default_tts_strategy,
          enable_notifications
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          settingsId,
          userId,
          defaultSettings.elevenLabsKeyEncrypted,
          defaultSettings.ttsProvider,
          defaultSettings.defaultPreset,
          defaultSettings.defaultVoiceAccent,
          defaultSettings.defaultTtsStrategy,
          defaultSettings.enableNotifications,
        ],
      );
      await client.query(
        `
        UPDATE alpha_invites
        SET status = 'accepted',
            accepted_user_id = $2,
            accepted_at = NOW()
        WHERE id = $1
        `,
        [invite.id, userId],
      );

      await client.query('COMMIT');
      return mapUserRow(userResult.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
}

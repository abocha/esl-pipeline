import './support/bootstrap-pg-test-env.js';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAlphaInvite, registerInvitedUser } from '../src/application/alpha-invites.js';
import { sanitizeSettings } from '../src/domain/settings-model.js';
import {
  createDefaultSettings,
  getDecryptedElevenLabsKey,
  getSettingsByUserId,
  upsertSettings,
} from '../src/domain/settings-repository.js';
import { closePgPool, withPgClientSessionContext } from '../src/infrastructure/db.js';
import { runMigrations } from '../src/infrastructure/migrations.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

async function resetAlphaSignupTables(): Promise<void> {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      'TRUNCATE TABLE alpha_invites, workspace_business_settings, workspace_memberships, workspaces, user_settings, users RESTART IDENTITY CASCADE',
    );
  });
}

describe('application/alpha-invites invited registration', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    await resetAlphaSignupTables();
  });

  afterAll(async () => {
    await resetAlphaSignupTables();
    await closePgPool();
  });

  it('creates an active user and owner workspace from a valid invite', async () => {
    const invite = await createAlphaInvite({
      email: 'Teacher@Example.com',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const user = await registerInvitedUser({
      email: ' teacher@example.com ',
      passwordHash: 'hashed-password',
      inviteToken: invite.token,
    });

    expect(user.email).toBe('teacher@example.com');
    expect(user.role).toBe('user');
    expect(user.isActive).toBe(true);

    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const membership = await client.query<{ role: string }>(
        'SELECT role FROM workspace_memberships WHERE user_id = $1',
        [user.id],
      );
      const settings = await client.query('SELECT 1 FROM user_settings WHERE user_id = $1', [
        user.id,
      ]);
      const inviteRow = await client.query<{ status: string; accepted_user_id: string }>(
        'SELECT status, accepted_user_id FROM alpha_invites WHERE id = $1',
        [invite.invite.id],
      );

      expect(membership.rows).toEqual([{ role: 'owner' }]);
      expect(settings.rowCount).toBe(1);
      expect(inviteRow.rows[0]).toEqual({ status: 'accepted', accepted_user_id: user.id });
    });
  });

  it('rejects an email mismatch without creating user or workspace rows', async () => {
    const invite = await createAlphaInvite({
      email: 'teacher@example.com',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await expect(
      registerInvitedUser({
        email: 'other@example.com',
        passwordHash: 'hashed-password',
        inviteToken: invite.token,
      }),
    ).rejects.toMatchObject({ code: 'invalid_invite' });

    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const counts = await client.query<{
        users: string;
        workspaces: string;
        accepted_invites: string;
      }>(
        `
        SELECT
          (SELECT COUNT(*) FROM users)::text AS users,
          (SELECT COUNT(*) FROM workspaces)::text AS workspaces,
          (SELECT COUNT(*) FROM alpha_invites WHERE status = 'accepted')::text AS accepted_invites
        `,
      );

      expect(counts.rows[0]).toEqual({
        users: '0',
        workspaces: '0',
        accepted_invites: '0',
      });
    });
  });

  it('keeps owner-keyed defaults, encrypted keys and partial updates isolated under concurrent writes', async () => {
    async function register(email: string) {
      const invite = await createAlphaInvite({ email, expiresAt: new Date(Date.now() + 60_000) });
      return registerInvitedUser({ email, passwordHash: 'fixture', inviteToken: invite.token });
    }
    const user = await register('settings@example.com');
    const other = await register('other@example.com');
    const otherBefore = await getSettingsByUserId(other.id);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query('DELETE FROM user_settings WHERE user_id = $1', [user.id]);
    });
    const defaults = await Promise.all([
      createDefaultSettings(user.id),
      createDefaultSettings(user.id),
    ]);
    expect(defaults[0]).toEqual({ ...defaults[1], updatedAt: expect.any(Date) });
    expect(defaults[0]).not.toHaveProperty('id');
    expect(defaults[0]).toMatchObject({
      userId: user.id,
      ttsProvider: 'elevenlabs',
      enableNotifications: true,
    });
    const keyed = await upsertSettings(user.id, {
      elevenLabsKey: 'fixture-api-key',
      ttsProvider: 'inworld',
      defaultPreset: 'b2-intermediate',
      defaultVoiceAccent: 'british',
      defaultTtsStrategy: 'dialogue',
      enableNotifications: false,
    });
    expect(keyed.elevenLabsKeyEncrypted).not.toBe('fixture-api-key');
    expect(await getDecryptedElevenLabsKey(user.id)).toBe('fixture-api-key');
    await Promise.all([
      upsertSettings(user.id, { defaultPreset: 'c1-advanced' }),
      upsertSettings(user.id, { enableNotifications: true }),
    ]);
    const updated = await getSettingsByUserId(user.id);
    expect(updated).toMatchObject({
      ...keyed,
      defaultPreset: 'c1-advanced',
      enableNotifications: true,
      updatedAt: expect.any(Date),
    });
    expect(sanitizeSettings(updated!)).toMatchObject({
      hasElevenLabsKey: true,
      ttsProvider: 'inworld',
    });
    expect(sanitizeSettings(updated!)).not.toHaveProperty('elevenLabsKeyEncrypted');
    expect(await getSettingsByUserId(other.id)).toEqual(otherBefore);
    expect(await upsertSettings(user.id, { elevenLabsKey: null })).toMatchObject({
      elevenLabsKeyEncrypted: null,
    });
    expect(await getDecryptedElevenLabsKey(user.id)).toBeNull();
    expect(await upsertSettings(user.id, { elevenLabsKey: '' })).toMatchObject({
      elevenLabsKeyEncrypted: null,
    });
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query('DELETE FROM user_settings WHERE user_id = $1', [user.id]);
    });
    expect(
      await upsertSettings(user.id, { defaultTtsStrategy: 'tts', enableNotifications: false }),
    ).toMatchObject({
      userId: user.id,
      elevenLabsKeyEncrypted: null,
      ttsProvider: 'elevenlabs',
      defaultPreset: 'b1-default',
      defaultVoiceAccent: 'american',
      defaultTtsStrategy: 'tts',
      enableNotifications: false,
    });
  });
});

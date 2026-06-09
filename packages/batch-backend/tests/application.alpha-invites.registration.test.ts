import './support/bootstrap-pg-test-env.js';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAlphaInvite, registerInvitedUser } from '../src/application/alpha-invites.js';
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
});

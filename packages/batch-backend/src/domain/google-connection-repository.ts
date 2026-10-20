import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { loadConfig } from '../config/env.js';
import { withPgClient, withSanitizedPgLogging } from '../infrastructure/db.js';
import {
  type GoogleGrantTokens,
  GoogleOAuthClient,
} from '../infrastructure/google-oauth-client.js';
import { IntegrationCredentials } from '../infrastructure/integration-credentials.js';

export class CalendarConnectionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 409,
  ) {
    super(code);
    this.name = 'CalendarConnectionError';
  }
}

export const hashCalendarSecret = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
export const randomCalendarSecret = (): string => randomBytes(32).toString('base64url');

export function calendarCredentialServices() {
  const config = loadConfig().googleCalendar;
  if (!config?.enabled) throw new CalendarConnectionError('google_calendar_disabled', 503);
  if (config.configurationError)
    throw new CalendarConnectionError('google_calendar_configuration_invalid', 503);
  return {
    config,
    credentials: new IntegrationCredentials(config.activeKeyId, config.encryptionKeys),
    oauth: new GoogleOAuthClient(config),
  };
}

export async function calendarTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withSanitizedPgLogging(() =>
    withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }),
  );
}

export async function assertWorkspaceCalendarRole(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  management = false,
): Promise<void> {
  const { rows } = await client.query<{ role: string }>(
    `SELECT m.role FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND u.is_active FOR SHARE OF m,u`,
    [workspaceId, userId],
  );
  if (
    !rows[0] ||
    !(management ? ['owner', 'admin'] : ['owner', 'admin', 'member']).includes(rows[0].role)
  )
    throw new CalendarConnectionError('calendar_permission_changed', 403);
}

interface ConnectionRow {
  id: string;
  workspace_id: string;
  grant_id: string;
  calendar_id: string;
  generation: number;
  status: string;
  authorizing_user_id: string;
  grant_status: string;
  credential_epoch: number;
  refresh_credential: string;
  access_credential: string | null;
  access_expires_at: Date | null;
  subject: string;
  issuer: string;
  client_id: string;
}
const connectionQuery = `SELECT c.*,g.authorizing_user_id,g.status AS grant_status,g.credential_epoch,g.refresh_credential,g.access_credential,g.access_expires_at,g.subject,g.issuer,g.client_id FROM workspace_calendar_connections c JOIN google_oauth_grants g ON g.id=c.grant_id AND g.workspace_id=c.workspace_id WHERE c.id=$1`;

async function lockedConnection(
  client: PoolClient,
  connectionId: string,
  generation: number,
): Promise<ConnectionRow> {
  const initial = (await client.query<ConnectionRow>(connectionQuery, [connectionId])).rows[0];
  if (!initial) throw new CalendarConnectionError('calendar_connection_unavailable');
  await assertWorkspaceCalendarRole(
    client,
    initial.workspace_id,
    initial.authorizing_user_id,
    true,
  );
  // Membership-change triggers take grant then connection locks in this same order.
  await client.query('SELECT id FROM google_oauth_grants WHERE id=$1 FOR UPDATE', [
    initial.grant_id,
  ]);
  const current = (
    await client.query<ConnectionRow>(`${connectionQuery} FOR UPDATE OF c`, [connectionId])
  ).rows[0];
  if (
    !current ||
    current.grant_id !== initial.grant_id ||
    current.generation !== generation ||
    current.status !== 'connected' ||
    current.grant_status !== 'active'
  )
    throw new CalendarConnectionError('calendar_connection_changed');
  if (current.client_id !== calendarCredentialServices().config.clientId)
    throw new CalendarConnectionError('calendar_reconnect_required');
  return current;
}

export async function assertCalendarConnectionAuthority(
  client: PoolClient,
  connectionId: string,
  generation: number,
): Promise<void> {
  await lockedConnection(client, connectionId, generation);
}

const grantContext = (
  grant: Pick<
    ConnectionRow,
    'grant_id' | 'authorizing_user_id' | 'subject' | 'issuer' | 'client_id'
  >,
): string =>
  JSON.stringify([
    'google-grant',
    grant.grant_id,
    grant.authorizing_user_id,
    grant.issuer,
    grant.subject,
    grant.client_id,
  ]);

/** Each call rechecks current authorizer and generation. Late refresh results cannot restore a fenced grant. */
export async function getCalendarAccess(
  connectionId: string,
  generation: number,
): Promise<{ accessToken: string; calendarId: string; workspaceId: string }> {
  const services = calendarCredentialServices();
  const lease = randomUUID();
  const claimed = await calendarTransaction(async (client) => {
    const row = await lockedConnection(client, connectionId, generation);
    if (
      row.access_credential &&
      row.access_expires_at &&
      row.access_expires_at.getTime() > Date.now() + 60_000
    )
      return {
        row,
        accessToken: services.credentials.decrypt(row.access_credential, grantContext(row)),
      };
    const result = await client.query(
      `UPDATE google_oauth_grants SET refresh_lease_token=$2,refresh_lease_expires_at=now()+interval '60 seconds' WHERE id=$1 AND (refresh_lease_token IS NULL OR refresh_lease_expires_at<now()) RETURNING id`,
      [row.grant_id, lease],
    );
    if (!result.rowCount) throw new CalendarConnectionError('calendar_refresh_busy', 503);
    return { row, accessToken: null };
  });
  if (claimed.accessToken)
    return {
      accessToken: claimed.accessToken,
      calendarId: claimed.row.calendar_id,
      workspaceId: claimed.row.workspace_id,
    };
  try {
    const tokens = await services.oauth.refresh(
      services.credentials.decrypt(claimed.row.refresh_credential, grantContext(claimed.row)),
    );
    return await calendarTransaction(async (client) => {
      const current = await lockedConnection(client, connectionId, generation);
      const result = await client.query(
        `UPDATE google_oauth_grants SET access_credential=$4,access_expires_at=$5,refresh_credential=COALESCE($6,refresh_credential),refresh_lease_token=NULL,refresh_lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND credential_epoch=$2 AND refresh_lease_token=$3 AND refresh_lease_expires_at>now() RETURNING id`,
        [
          current.grant_id,
          claimed.row.credential_epoch,
          lease,
          services.credentials.encrypt(tokens.accessToken, grantContext(current)),
          tokens.expiresAt,
          tokens.refreshToken
            ? services.credentials.encrypt(tokens.refreshToken, grantContext(current))
            : null,
        ],
      );
      if (!result.rowCount) throw new CalendarConnectionError('calendar_refresh_fenced');
      return {
        accessToken: tokens.accessToken,
        calendarId: current.calendar_id,
        workspaceId: current.workspace_id,
      };
    });
  } catch (error) {
    await calendarTransaction(async (client) => {
      const permanent = (error as { code?: string })?.code === 'google_reauthorization_required';
      const result = await client.query(
        `UPDATE google_oauth_grants SET refresh_lease_token=NULL,refresh_lease_expires_at=NULL,status=CASE WHEN $4 THEN 'reconnect_required' ELSE status END,credential_epoch=credential_epoch+CASE WHEN $4 THEN 1 ELSE 0 END WHERE id=$1 AND credential_epoch=$2 AND refresh_lease_token=$3 RETURNING id`,
        [claimed.row.grant_id, claimed.row.credential_epoch, lease, permanent],
      );
      if (permanent && result.rowCount)
        await client.query(
          `UPDATE workspace_calendar_connections SET status='reconnect_required',generation=generation+1,error_code='google_reauthorization_required',lease_token=NULL,lease_expires_at=NULL WHERE grant_id=$1 AND status='connected'`,
          [claimed.row.grant_id],
        );
    });
    throw error;
  }
}

export async function invalidateCalendarBrowserAttempts(
  binding: string | undefined,
): Promise<void> {
  if (!binding) return;
  await calendarTransaction(async (client) => {
    await client.query(
      `UPDATE google_oauth_attempts SET status='invalidated' WHERE browser_binding_hash=$1 AND status IN ('pending','claimed')`,
      [hashCalendarSecret(binding)],
    );
  });
}

export async function beginCalendarAttempt(
  userId: string,
  workspaceId: string,
  oldBinding: string | undefined,
): Promise<{ binding: string; authorizationUrl: string }> {
  const { credentials, oauth } = calendarCredentialServices();
  const binding = randomCalendarSecret(),
    state = randomCalendarSecret(),
    nonce = randomCalendarSecret(),
    verifier = randomCalendarSecret(),
    id = randomUUID();
  await calendarTransaction(async (client) => {
    if (oldBinding)
      await client.query(
        `UPDATE google_oauth_attempts SET status='invalidated' WHERE browser_binding_hash=$1 AND status IN ('pending','claimed')`,
        [hashCalendarSecret(oldBinding)],
      );
    await assertWorkspaceCalendarRole(client, workspaceId, userId, true);
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId]);
    const connection = (
      await client.query<{ id: string; generation: number }>(
        `SELECT id,generation FROM workspace_calendar_connections WHERE workspace_id=$1 AND status<>'disconnected'`,
        [workspaceId],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO google_oauth_attempts(id,state_hash,browser_binding_hash,requesting_user_id,workspace_id,purpose,verifier_encrypted,nonce,expires_at,connection_id,connection_generation) VALUES($1,$2,$3,$4,$5,'connect-calendar',$6,$7,now()+interval '10 minutes',$8,$9)`,
      [
        id,
        hashCalendarSecret(state),
        hashCalendarSecret(binding),
        userId,
        workspaceId,
        credentials.encrypt(verifier, `google-attempt:${id}:${userId}`),
        nonce,
        connection?.id ?? null,
        connection?.generation ?? null,
      ],
    );
  });
  return {
    binding,
    authorizationUrl: oauth.authorizationUrl(
      state,
      nonce,
      createHash('sha256').update(verifier).digest('base64url'),
    ),
  };
}

interface AttemptRow {
  id: string;
  requesting_user_id: string;
  workspace_id: string;
  verifier_encrypted: string;
  nonce: string;
  connection_id: string | null;
  connection_generation: number | null;
}

export async function completeCalendarAttempt(input: {
  state: string;
  binding: string;
  userId: string;
  code: string;
}): Promise<void> {
  const { credentials, oauth, config } = calendarCredentialServices();
  const attempt = await calendarTransaction(async (client) => {
    const row = (
      await client.query<AttemptRow>(
        `SELECT * FROM google_oauth_attempts WHERE state_hash=$1 AND browser_binding_hash=$2 AND requesting_user_id=$3 AND purpose='connect-calendar' AND status='pending' AND expires_at>now() FOR UPDATE`,
        [hashCalendarSecret(input.state), hashCalendarSecret(input.binding), input.userId],
      )
    ).rows[0];
    if (!row) throw new CalendarConnectionError('calendar_attempt_invalid', 400);
    await assertWorkspaceCalendarRole(client, row.workspace_id, input.userId, true);
    await client.query(`UPDATE google_oauth_attempts SET status='claimed' WHERE id=$1`, [row.id]);
    return row;
  });
  try {
    const tokens = await oauth.exchange(
      input.code,
      credentials.decrypt(
        attempt.verifier_encrypted,
        `google-attempt:${attempt.id}:${input.userId}`,
      ),
      attempt.nonce,
    );
    await calendarTransaction(async (client) => {
      // Logout/account change and callback completion serialize on this exact row.
      const valid = await client.query(
        `SELECT id FROM google_oauth_attempts WHERE id=$1 AND status='claimed' AND expires_at>now() FOR UPDATE`,
        [attempt.id],
      );
      if (!valid.rowCount) throw new CalendarConnectionError('calendar_attempt_invalid', 400);
      await assertWorkspaceCalendarRole(client, attempt.workspace_id, input.userId, true);
      await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [
        attempt.workspace_id,
      ]);
      const connection = (
        await client.query<{ id: string; generation: number }>(
          `SELECT id,generation FROM workspace_calendar_connections WHERE workspace_id=$1 AND status<>'disconnected'`,
          [attempt.workspace_id],
        )
      ).rows[0];
      if (
        (connection?.id ?? null) !== attempt.connection_id ||
        (connection?.generation ?? null) !== attempt.connection_generation
      )
        throw new CalendarConnectionError('calendar_connection_changed');
      await saveGrant(client, attempt, tokens, credentials, config.clientId);
      await client.query(`UPDATE google_oauth_attempts SET status='completed' WHERE id=$1`, [
        attempt.id,
      ]);
    });
  } catch (error) {
    await calendarTransaction(async (client) => {
      await client.query(
        `UPDATE google_oauth_attempts SET status='invalidated' WHERE id=$1 AND status IN ('pending','claimed')`,
        [attempt.id],
      );
    });
    throw error;
  }
}

async function saveGrant(
  client: PoolClient,
  attempt: AttemptRow,
  tokens: GoogleGrantTokens,
  credentials: IntegrationCredentials,
  clientId: string,
): Promise<void> {
  const old = (
    await client.query<{ id: string; refresh_credential: string }>(
      `SELECT id,refresh_credential FROM google_oauth_grants WHERE workspace_id=$1 AND authorizing_user_id=$2 AND issuer=$3 AND subject=$4 AND client_id=$5 FOR UPDATE`,
      [attempt.workspace_id, attempt.requesting_user_id, tokens.issuer, tokens.subject, clientId],
    )
  ).rows[0];
  if (!tokens.refreshToken && !old?.refresh_credential)
    throw new CalendarConnectionError('google_offline_required');
  const id = old?.id ?? randomUUID();
  const ctx = grantContext({
    grant_id: id,
    authorizing_user_id: attempt.requesting_user_id,
    subject: tokens.subject,
    issuer: tokens.issuer,
    client_id: clientId,
  });
  const refresh = tokens.refreshToken
    ? credentials.encrypt(tokens.refreshToken, ctx)
    : old!.refresh_credential;
  await client.query(
    `INSERT INTO google_oauth_grants(id,workspace_id,authorizing_user_id,issuer,subject,client_id,google_email,granted_scopes,refresh_credential,access_credential,access_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET google_email=excluded.google_email,granted_scopes=excluded.granted_scopes,refresh_credential=excluded.refresh_credential,access_credential=excluded.access_credential,access_expires_at=excluded.access_expires_at,status='active',credential_epoch=google_oauth_grants.credential_epoch+1,refresh_lease_token=NULL,refresh_lease_expires_at=NULL,updated_at=now()`,
    [
      id,
      attempt.workspace_id,
      attempt.requesting_user_id,
      tokens.issuer,
      tokens.subject,
      clientId,
      tokens.email,
      tokens.scopes,
      refresh,
      credentials.encrypt(tokens.accessToken, ctx),
      tokens.expiresAt,
    ],
  );
}

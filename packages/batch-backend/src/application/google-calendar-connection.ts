import { randomUUID } from 'node:crypto';

import type {
  CalendarConnectionDto,
  CalendarConnectionStatusDto,
  CalendarSelectionDto,
} from '@esl-pipeline/contracts';

import { loadConfig } from '../config/env.js';
import {
  assertWorkspaceCalendarRole,
  CalendarConnectionError,
  calendarCredentialServices,
  calendarTransaction,
} from '../domain/google-connection-repository.js';

interface GrantRow {
  id: string;
  workspace_id: string;
  authorizing_user_id: string;
  issuer: string;
  subject: string;
  client_id: string;
  google_email: string;
  refresh_credential: string;
  access_credential: string | null;
  access_expires_at: Date | null;
  credential_epoch: number;
  status: string;
}
const context = (g: GrantRow): string =>
  JSON.stringify(['google-grant', g.id, g.authorizing_user_id, g.issuer, g.subject, g.client_id]);

async function pendingGrantAccess(
  workspaceId: string,
  userId: string,
): Promise<{ grant: GrantRow; accessToken: string }> {
  const services = calendarCredentialServices();
  const lease = randomUUID();
  const selected = await calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId, true);
    const grant = (
      await client.query<GrantRow>(
        `SELECT * FROM google_oauth_grants WHERE workspace_id=$1 AND authorizing_user_id=$2 AND client_id=$3 AND status='active' ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
        [workspaceId, userId, services.config.clientId],
      )
    ).rows[0];
    if (!grant) throw new CalendarConnectionError('google_connect_required');
    if (
      grant.access_credential &&
      grant.access_expires_at &&
      grant.access_expires_at.getTime() > Date.now() + 60_000
    )
      return {
        grant,
        accessToken: services.credentials.decrypt(grant.access_credential, context(grant)),
      };
    const claim = await client.query(
      `UPDATE google_oauth_grants SET refresh_lease_token=$2,refresh_lease_expires_at=now()+interval '60 seconds' WHERE id=$1 AND (refresh_lease_token IS NULL OR refresh_lease_expires_at<now()) RETURNING id`,
      [grant.id, lease],
    );
    if (!claim.rowCount) throw new CalendarConnectionError('calendar_refresh_busy', 503);
    return { grant, accessToken: null };
  });
  if (selected.accessToken) return { grant: selected.grant, accessToken: selected.accessToken };
  try {
    const tokens = await services.oauth.refresh(
      services.credentials.decrypt(selected.grant.refresh_credential, context(selected.grant)),
    );
    await calendarTransaction(async (client) => {
      await assertWorkspaceCalendarRole(client, workspaceId, userId, true);
      const saved = await client.query(
        `UPDATE google_oauth_grants SET access_credential=$4,access_expires_at=$5,refresh_credential=COALESCE($6,refresh_credential),refresh_lease_token=NULL,refresh_lease_expires_at=NULL WHERE id=$1 AND credential_epoch=$2 AND refresh_lease_token=$3 AND refresh_lease_expires_at>now() AND status='active' RETURNING id`,
        [
          selected.grant.id,
          selected.grant.credential_epoch,
          lease,
          services.credentials.encrypt(tokens.accessToken, context(selected.grant)),
          tokens.expiresAt,
          tokens.refreshToken
            ? services.credentials.encrypt(tokens.refreshToken, context(selected.grant))
            : null,
        ],
      );
      if (!saved.rowCount) throw new CalendarConnectionError('calendar_refresh_fenced');
    });
    return { grant: selected.grant, accessToken: tokens.accessToken };
  } catch (error) {
    await calendarTransaction(async (client) => {
      const permanent = (error as { code?: string }).code === 'google_reauthorization_required';
      const changed = await client.query(
        `UPDATE google_oauth_grants SET refresh_lease_token=NULL,refresh_lease_expires_at=NULL,status=CASE WHEN $4 THEN 'reconnect_required' ELSE status END,credential_epoch=credential_epoch+CASE WHEN $4 THEN 1 ELSE 0 END WHERE id=$1 AND credential_epoch=$2 AND refresh_lease_token=$3 RETURNING id`,
        [selected.grant.id, selected.grant.credential_epoch, lease, permanent],
      );
      if (permanent && changed.rowCount)
        await client.query(
          `UPDATE workspace_calendar_connections SET status='reconnect_required',generation=generation+1,error_code='google_reauthorization_required',lease_token=NULL,lease_expires_at=NULL WHERE grant_id=$1 AND status='connected'`,
          [selected.grant.id],
        );
    });
    throw error;
  }
}

const connectionColumns = `c.id,c.workspace_id AS "workspaceId",c.calendar_id AS "calendarId",c.calendar_name AS "calendarName",c.calendar_timezone AS "calendarTimezone",g.google_email AS "googleEmail",c.generation,c.status,c.last_synced_at AS "lastSyncedAt",c.error_code AS "errorCode"`;
export async function getCalendarConnectionStatus(
  workspaceId: string,
  userId: string,
): Promise<CalendarConnectionStatusDto> {
  return calendarTransaction(async (client) => {
    // Viewers may inspect connection status without gaining management permission.
    const member = await client.query<{ role: string }>(
      `SELECT m.role FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND u.is_active`,
      [workspaceId, userId],
    );
    if (!member.rowCount) throw new CalendarConnectionError('calendar_permission_changed', 403);
    const connection = (
      await client.query<CalendarConnectionDto & { lastSyncedAt: string | Date | null }>(
        `SELECT ${connectionColumns} FROM workspace_calendar_connections c JOIN google_oauth_grants g ON g.id=c.grant_id WHERE c.workspace_id=$1 ORDER BY (c.status<>'disconnected') DESC,c.updated_at DESC LIMIT 1`,
        [workspaceId],
      )
    ).rows[0];
    const grant = (
      await client.query<{ id: string; googleEmail: string }>(
        `SELECT id,google_email AS "googleEmail" FROM google_oauth_grants WHERE workspace_id=$1 AND authorizing_user_id=$2 AND status='active' ORDER BY updated_at DESC LIMIT 1`,
        [workspaceId, userId],
      )
    ).rows[0];
    const config = loadConfig().googleCalendar;
    const role = member.rows[0]!.role;
    return {
      enabled: config?.enabled === true && !config.configurationError,
      canManage: ['owner', 'admin'].includes(role),
      canSchedule: ['owner', 'admin', 'member'].includes(role),
      unavailableReason:
        config?.configurationError ?? (config?.enabled ? null : 'google_calendar_disabled'),
      connection: connection
        ? {
            ...connection,
            lastSyncedAt: connection.lastSyncedAt
              ? new Date(connection.lastSyncedAt).toISOString()
              : null,
          }
        : null,
      grant: grant ?? null,
    };
  });
}

async function fetchCalendars(accessToken: string): Promise<CalendarSelectionDto[]> {
  const calendars: CalendarSelectionDto[] = [];
  let pageToken: string | undefined;
  const seen = new Set<string>();
  do {
    const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    url.searchParams.set('minAccessRole', 'writer');
    url.searchParams.set('maxResults', '250');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    }).catch(() => {
      throw new CalendarConnectionError('google_unavailable', 503);
    });
    if (!response.ok)
      throw new CalendarConnectionError(
        response.status === 401 || response.status === 403
          ? 'google_reauthorization_required'
          : 'google_unavailable',
        503,
      );
    const data = (await response.json()) as {
      items?: {
        id?: string;
        summary?: string;
        timeZone?: string;
        accessRole?: string;
        deleted?: boolean;
      }[];
      nextPageToken?: string;
    };
    if (!Array.isArray(data.items))
      throw new CalendarConnectionError('google_calendar_response_invalid', 503);
    for (const item of data.items)
      if (
        typeof item.id === 'string' &&
        typeof item.summary === 'string' &&
        typeof item.timeZone === 'string' &&
        (item.accessRole === 'writer' || item.accessRole === 'owner') &&
        !item.deleted
      )
        calendars.push({
          id: item.id,
          summary: item.summary,
          timeZone: item.timeZone,
          accessRole: item.accessRole,
        });
    pageToken = data.nextPageToken;
    if (pageToken && (typeof pageToken !== 'string' || seen.has(pageToken)))
      throw new CalendarConnectionError('google_calendar_response_invalid', 503);
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return calendars;
}

export async function listGoogleLessonCalendars(
  workspaceId: string,
  userId: string,
): Promise<CalendarSelectionDto[]> {
  const { grant, accessToken } = await pendingGrantAccess(workspaceId, userId);
  const result = await fetchCalendars(accessToken);
  // A role change while the request was in flight must also fence the response.
  await calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId, true);
    const valid = await client.query(
      `SELECT id FROM google_oauth_grants WHERE id=$1 AND credential_epoch=$2 AND status='active'`,
      [grant.id, grant.credential_epoch],
    );
    if (!valid.rowCount) throw new CalendarConnectionError('calendar_connection_changed');
  });
  return result;
}

export async function selectGoogleLessonCalendar(
  workspaceId: string,
  userId: string,
  calendarId: string,
  confirmReplacement: boolean,
): Promise<CalendarConnectionDto> {
  const { grant, accessToken } = await pendingGrantAccess(workspaceId, userId);
  const selected = (await fetchCalendars(accessToken)).find(
    (calendar) => calendar.id === calendarId,
  );
  if (!selected) throw new CalendarConnectionError('google_calendar_not_writable', 400);
  await calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId, true);
    await client.query(
      `UPDATE google_oauth_attempts SET status='invalidated' WHERE workspace_id=$1 AND status IN ('pending','claimed')`,
      [workspaceId],
    );
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId]);
    const valid = await client.query(
      `SELECT id FROM google_oauth_grants WHERE id=$1 AND workspace_id=$2 AND credential_epoch=$3 AND status='active' FOR UPDATE`,
      [grant.id, workspaceId, grant.credential_epoch],
    );
    if (!valid.rowCount) throw new CalendarConnectionError('calendar_connection_changed');
    const old = (
      await client.query<{ id: string; calendar_id: string; subject: string; client_id: string }>(
        `SELECT c.id,c.calendar_id,g.subject,g.client_id FROM workspace_calendar_connections c JOIN google_oauth_grants g ON g.id=c.grant_id WHERE c.workspace_id=$1 ORDER BY (c.status<>'disconnected') DESC,c.updated_at DESC LIMIT 1 FOR UPDATE OF c`,
        [workspaceId],
      )
    ).rows[0];
    const same =
      old?.calendar_id === calendarId &&
      old.subject === grant.subject &&
      old.client_id === grant.client_id;
    if (old && !same && !confirmReplacement)
      throw new CalendarConnectionError('calendar_replacement_confirmation_required');
    // Serialize selection for this provider identity as well as this workspace. A previous
    // local disconnect keeps mappings; explicit reconnect must reuse their connection ID.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `calendar-selection:${calendarId}`,
    ]);
    const shared = await client.query(
      `SELECT id FROM workspace_calendar_connections WHERE calendar_id=$1 AND workspace_id<>$2 AND status<>'disconnected'`,
      [calendarId, workspaceId],
    );
    if (shared.rowCount) throw new CalendarConnectionError('calendar_already_connected');
    const historical = same
      ? old
      : (
          await client.query<{ id: string }>(
            `SELECT c.id FROM workspace_calendar_connections c JOIN google_oauth_grants g ON g.id=c.grant_id WHERE c.workspace_id=$1 AND c.calendar_id=$2 AND g.subject=$3 AND g.client_id=$4 ORDER BY c.updated_at DESC LIMIT 1 FOR UPDATE OF c`,
            [workspaceId, calendarId, grant.subject, grant.client_id],
          )
        ).rows[0];
    if (old && old.id !== historical?.id)
      await client.query(
        `UPDATE workspace_calendar_connections SET status='disconnected',generation=generation+1,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1`,
        [old.id],
      );
    if (historical) {
      const renewed = await client.query<{ generation: number }>(
        `UPDATE workspace_calendar_connections SET grant_id=$2,calendar_name=$3,calendar_timezone=$4,status='connected',generation=generation+1,error_code=NULL,sync_token=NULL,sync_page_token=NULL,next_sync_at=now(),lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 RETURNING generation`,
        [historical.id, grant.id, selected.summary, selected.timeZone],
      );
      // The same verified source resumes immutable intents. Lost in-flight writes recover by
      // GET first; never mint a replacement event or silently transfer to another calendar.
      await client.query(
        `UPDATE calendar_operations SET connection_generation=$2,
          state=CASE WHEN state='needs_review' THEN state ELSE 'pending' END,
          error_code=CASE WHEN state='needs_review' THEN error_code ELSE NULL END,
          lease_token=NULL,lease_expires_at=NULL,due_at=now(),updated_at=now()
        WHERE connection_id=$1 AND kind<>'setup' AND (state IN ('pending','running','retry_wait','needs_review') OR (state='superseded' AND error_code='connection_changed'))`,
        [historical.id, renewed.rows[0]!.generation],
      );
    } else {
      await client.query(
        `INSERT INTO workspace_calendar_connections(id,workspace_id,grant_id,calendar_id,calendar_name,calendar_timezone,status) VALUES($1,$2,$3,$4,$5,$6,'connected')`,
        [randomUUID(), workspaceId, grant.id, calendarId, selected.summary, selected.timeZone],
      );
    }
  });
  return (await getCalendarConnectionStatus(workspaceId, userId)).connection!;
}

export async function disconnectGoogleLessonCalendar(
  workspaceId: string,
  userId: string,
): Promise<void> {
  await calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId, true);
    // Invalidate attempts first: callback locks attempt before workspace/grant.
    await client.query(
      `UPDATE google_oauth_attempts SET status='invalidated' WHERE workspace_id=$1 AND status IN ('pending','claimed')`,
      [workspaceId],
    );
    await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId]);
    await client.query(
      `UPDATE google_oauth_grants SET credential_epoch=credential_epoch+1,status='disconnected',refresh_lease_token=NULL,refresh_lease_expires_at=NULL WHERE workspace_id=$1 AND status<>'disconnected'`,
      [workspaceId],
    );
    await client.query(
      `UPDATE workspace_calendar_connections SET status='disconnected',generation=generation+1,error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE workspace_id=$1 AND status<>'disconnected'`,
      [workspaceId],
    );
  });
}

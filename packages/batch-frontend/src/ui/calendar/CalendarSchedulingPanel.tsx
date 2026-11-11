import { isAxiosError } from 'axios';
import { CalendarDays, Check, Link2, RefreshCw, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  CalendarConnectionStatusDto,
  CalendarOperationReviewDto,
  CalendarSchedulingStatusDto,
  CalendarSelectionDto,
  CalendarSetupDto,
  CalendarSetupRequestDto,
  CalendarSlotDto,
  CalendarUnlinkedEventDto,
} from '@esl-pipeline/contracts';
import { calendarSetupRequestSchema } from '@esl-pipeline/contracts';

import { useWorkspaceSettings } from '../../context/WorkspaceTimezoneContext';
import {
  adoptCalendarOperation,
  beginCalendarConnect,
  bindCalendarEvent,
  createCalendarSetup,
  disconnectLessonCalendar,
  getCalendarConnection,
  getCalendarSchedulingStatus,
  getCalendarSetup,
  getCalendarUnlinkedEvents,
  getLessonCalendars,
  requestCalendarSync,
  retryCalendarOperation,
  reviewCalendarOperation,
  selectLessonCalendar,
  updateStudentProfile,
} from '../../utils/api';
import { dateInputInTimezone } from '../../utils/scheduling-time';
import { normalizeTimezone, timezoneName } from '../../utils/timezones';
import { formatTutorTime } from '../../utils/tutor-time';
import { useStudioV2 } from '../studio-v2/StudioV2Context';
import { StudioV2Dialog } from '../studio-v2/StudioV2Dialog';
import { LoadingPlaceholder } from '../system/LoadingPlaceholder';
import './CalendarSchedulingPanel.css';

interface SavedSetup {
  key: string;
  request: CalendarSetupRequestDto;
  setupId?: string;
}
interface Props {
  workspaceId: string;
  timezone: string;
  studentId?: string;
  studentName?: string;
  email?: string | null;
  defaultDurationMinutes?: number;
  onLedgerRefresh: () => Promise<void>;
  presentationActive?: boolean;
  routeHash?: string;
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Calendar action failed. Try again.';

const attentionCopy = (code: string) => {
  switch (code) {
    case 'lesson_attention_required':
      return 'The teaching calendar has lesson issues. Details are unavailable.';
    case 'association_required':
      return 'ESL Pipeline could not match the Google event to the lesson.';
    case 'association_provenance_conflict':
    case 'identity_conflict':
      return 'The Google event conflicts with an existing lesson link.';
    case 'unsupported_event':
      return 'ESL Pipeline could not use this event’s start or end time. Check that it is a timed event in Google Calendar.';
    case 'provider_event_missing':
      return 'ESL Pipeline could not find the linked event in Google Calendar.';
    case 'protected_lesson_changed':
      return 'Sync found a difference and kept the existing record to protect teaching history.';
    case 'protected_lesson_deleted':
      return 'The Google event was canceled or removed. Sync kept the existing lesson record.';
    case 'protected_series_changed':
      return 'Google Calendar changed the series. Sync kept lessons with protected records.';
    case 'invitation_declined':
      return 'The lesson invitation was declined in Google Calendar.';
    case 'sync_stale':
      return 'Calendar sync is behind. Use Sync now to request an update.';
  }
  if (
    [
      'google_reauthorization_required',
      'calendar_reconnect_required',
      'permission_changed',
      'membership_lost',
    ].includes(code)
  )
    return 'Calendar access has changed. Reconnect Google or ask a workspace owner to review the connection.';
  return 'This Calendar change needs review. Your teaching history and billing remain available.';
};
const outcomeLabels = {
  pending: 'Queued',
  running: 'Creating',
  retry_wait: 'Retry scheduled',
  succeeded: 'Created in Google',
  needs_review: 'Needs review',
  superseded: 'Replaced',
};

/** Calendar failures have their own state: they never replace the teaching ledger. */
export function CalendarSchedulingPanel({
  workspaceId,
  timezone,
  studentId,
  studentName,
  email,
  defaultDurationMinutes = 60,
  onLedgerRefresh,
  presentationActive = true,
  routeHash,
}: Props) {
  const workspace = useWorkspaceSettings();
  const storageKey = `calendar-setup:${workspaceId}:${studentId ?? 'workspace'}`;
  const [connection, setConnection] = useState<CalendarConnectionStatusDto | null>(null);
  const [status, setStatus] = useState<CalendarSchedulingStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestingSync, setRequestingSync] = useState(false);
  const [calendars, setCalendars] = useState<CalendarSelectionDto[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState('');
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [recipient, setRecipient] = useState(email ?? '');
  const [savedRecipient, setSavedRecipient] = useState(email ?? '');
  const [sendInvitation, setSendInvitation] = useState(Boolean(email));
  const [title, setTitle] = useState(`English lesson${studentName ? ` — ${studentName}` : ''}`);
  const [slots, setSlots] = useState<CalendarSlotDto[]>([
    {
      kind: 'weekly',
      weekday: 1,
      localTime: '11:00',
      startDate: dateInputInTimezone(new Date(), timezone),
      durationMinutes: defaultDurationMinutes,
    },
  ]);
  const draftTimezone = useRef(normalizeTimezone(timezone));
  const [saved, setSaved] = useState<SavedSetup | null>(null);
  const [setup, setSetup] = useState<CalendarSetupDto | null>(null);
  const [review, setReview] = useState<CalendarOperationReviewDto | null>(null);
  const [unlinked, setUnlinked] = useState<CalendarUnlinkedEventDto[]>([]);
  const [unlinkedNextPageToken, setUnlinkedNextPageToken] = useState<string | null>(null);
  const [unlinkedLoaded, setUnlinkedLoaded] = useState(false);
  const [linkedEventTitle, setLinkedEventTitle] = useState<string | null>(null);
  useEffect(() => {
    setUnlinked([]);
    setUnlinkedNextPageToken(null);
    setUnlinkedLoaded(false);
    setLinkedEventTitle(null);
  }, [workspaceId, connection?.connection?.id, connection?.connection?.generation]);
  const ledgerRefresh = useRef(onLedgerRefresh);
  ledgerRefresh.current = onLedgerRefresh;
  const succeeded = useRef('');
  const lastSyncedAt = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    setRecipient(email ?? '');
    setSavedRecipient(email ?? '');
    setSendInvitation(Boolean(email));
  }, [email]);
  useEffect(() => {
    setSetup(null);
    succeeded.current = '';
    lastSyncedAt.current = undefined;
    try {
      const value = localStorage.getItem(storageKey);
      const parsed: SavedSetup | null = value ? JSON.parse(value) : null;
      setSaved(
        parsed &&
          typeof parsed.key === 'string' &&
          calendarSetupRequestSchema.safeParse(parsed.request).success
          ? parsed
          : null,
      );
    } catch {
      setSaved(null);
    }
  }, [storageKey]);
  const refresh = useCallback(async () => {
    const [nextConnection, nextStatus] = await Promise.all([
      getCalendarConnection(workspaceId),
      getCalendarSchedulingStatus(workspaceId),
    ]);
    setConnection(nextConnection);
    setStatus(nextStatus);
    if (
      lastSyncedAt.current !== undefined &&
      nextStatus.lastSyncedAt &&
      lastSyncedAt.current !== nextStatus.lastSyncedAt
    ) {
      await ledgerRefresh.current();
    }
    lastSyncedAt.current = nextStatus.lastSyncedAt;
    if (saved?.setupId) {
      const next = await getCalendarSetup(workspaceId, saved.setupId);
      setSetup(next);
      const fingerprint = next.operations
        .filter((op) => op.state === 'succeeded')
        .map((op) => op.id)
        .sort()
        .join(':');
      if (fingerprint && fingerprint !== succeeded.current) {
        succeeded.current = fingerprint;
        await ledgerRefresh.current();
      }
    }
  }, [workspaceId, saved?.setupId]);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        await refresh();
      } catch (cause) {
        if (active) setError(message(cause));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refresh]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const syncNow = async () => {
    setRequestingSync(true);
    await run(() => requestCalendarSync(workspaceId));
    setRequestingSync(false);
  };
  const submit = async () => {
    if (!saved && draftTimezone.current !== normalizeTimezone(timezone)) {
      // Keep entered wall times, but require review before interpreting them in a
      // changed workspace clock. Captured requests always retain their own clock.
      draftTimezone.current = normalizeTimezone(timezone);
      throw new Error(
        'Tutor timezone changed. Review the lesson times and create the setup again.',
      );
    }
    // Persist before network admission. A timeout/reload must reuse the immutable request.
    const intent = saved ?? {
      key: crypto.randomUUID(),
      request: { title, timezone, sendInvitation: Boolean(recipient) && sendInvitation, slots },
    };
    localStorage.setItem(storageKey, JSON.stringify(intent));
    setSaved(intent);
    try {
      const result = await createCalendarSetup(workspaceId, studentId!, intent.request, intent.key);
      const persisted = { ...intent, setupId: result.id };
      localStorage.setItem(storageKey, JSON.stringify(persisted));
      setSaved(persisted);
      setSetup(result);
    } catch (cause) {
      if (
        !intent.setupId &&
        isAxiosError(cause) &&
        cause.response?.data?.error === 'workspace_timezone_changed'
      ) {
        // The backend definitively rejected fresh admission: no accepted operation
        // exists. Every other failure retains the immutable request and key.
        localStorage.removeItem(storageKey);
        setSaved(null);
        setSetup(null);
        setTitle(intent.request.title);
        setSlots(intent.request.slots);
        setSendInvitation(Boolean(intent.request.sendInvitation));
        const refreshedSettings = await workspace.refreshSettings();
        draftTimezone.current = normalizeTimezone(refreshedSettings?.timezone ?? timezone);
        throw new Error(
          'Tutor timezone changed. Review the lesson times and create the setup again.',
        );
      }
      throw cause;
    }
  };
  const updateSlot = (index: number, patch: Partial<CalendarSlotDto>) =>
    setSlots((current) => current.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  const studioV2 = useStudioV2();
  const [expanded, setExpanded] = useState(
    () => presentationActive && (routeHash ?? window.location.hash) === '#teaching-calendar',
  );
  const [drawerView, setDrawerView] = useState<'schedule' | 'link' | 'settings'>('schedule');
  const manageRef = useRef<HTMLButtonElement>(null);
  const drawerTrigger = useRef<HTMLButtonElement>(null);
  const closeDrawer = () => {
    const trigger = drawerTrigger.current ?? manageRef.current;
    drawerTrigger.current = null;
    setExpanded(false);
    window.setTimeout(() => trigger?.focus(), 0);
  };
  useEffect(() => {
    const openFromHash = () => {
      if (
        studioV2 &&
        presentationActive &&
        (routeHash ?? window.location.hash) === '#teaching-calendar'
      )
        setExpanded(true);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [studioV2, presentationActive, routeHash]);
  const needsAttention =
    error || status?.state === 'needs_attention' || status?.state === 'reconnect_required';
  useEffect(() => {
    if (!presentationActive) {
      drawerTrigger.current = null;
      setExpanded(false);
    }
  }, [presentationActive]);
  const unavailable = studioV2 && connection?.enabled === false;
  const connected = !unavailable && connection?.connection?.status === 'connected';
  const canConnect = connection?.enabled && connection.canManage;
  const choosingCalendar = studioV2 && !connected && canConnect && Boolean(connection?.grant);
  const canSchedule = connected && connection?.canSchedule;
  const canLink = connected && connection?.canManage;
  const hasScheduleView = Boolean(studentId && (canSchedule || saved));
  const activeView =
    studentId && canLink && drawerView === 'link'
      ? 'link'
      : hasScheduleView && drawerView !== 'settings'
        ? 'schedule'
        : 'settings';
  const showSettings = !studioV2 || choosingCalendar || (connected && activeView === 'settings');
  const loadUnlinkedEvents = () =>
    run(async () => {
      const page = await getCalendarUnlinkedEvents(workspaceId);
      setUnlinked(page.events);
      setUnlinkedNextPageToken(page.nextPageToken);
      setUnlinkedLoaded(true);
    });
  const calendarChoiceRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (studioV2 && presentationActive && expanded && !busy && calendars.length)
      calendarChoiceRef.current?.focus();
  }, [studioV2, presentationActive, expanded, busy, calendars.length]);
  const loadCalendars = () =>
    run(async () => {
      const result = await getLessonCalendars(workspaceId);
      setCalendars(result.calendars);
      if (studioV2) {
        const [onlyCalendar] = result.calendars;
        setSelectedCalendar(
          !connection?.connection && result.calendars.length === 1 ? (onlyCalendar?.id ?? '') : '',
        );
        setConfirmReplacement(false);
      }
      if (studioV2 && !result.calendars.length)
        throw new Error('No writable calendars found for this Google account.');
    });
  const connect = () =>
    run(async () => {
      const result = await beginCalendarConnect(workspaceId);
      window.location.assign(result.authorizationUrl);
    });
  const syncInProgress =
    requestingSync ||
    (status?.state === 'syncing' &&
      status.operations.some(
        ({ kind, state }) =>
          kind === 'sync' && (state === 'pending' || state === 'running' || state === 'retry_wait'),
      ));
  const minutesSinceSync = Math.floor(
    (Date.now() - Date.parse(status?.lastSyncedAt ?? '')) / 60_000,
  );
  const syncAge =
    minutesSinceSync === 0
      ? 'just now'
      : minutesSinceSync > 0 && minutesSinceSync < 60
        ? `${minutesSinceSync}m ago`
        : null;
  const statusPending = !status && !error && !unavailable;
  const stateLabel = unavailable
    ? 'Unavailable'
    : status
      ? {
          disconnected: 'Disconnected',
          reconnect_required: 'Reconnect required',
          syncing: 'Syncing',
          synced: syncAge ? `Synced ${syncAge}` : 'Synced',
          needs_attention: 'Needs attention',
        }[status.state]
      : error
        ? 'Needs attention'
        : 'Checking connection…';
  const ConnectionSettings = studioV2 ? 'section' : 'details';
  const CalendarAssociation = studioV2 ? 'section' : 'details';
  const calendarName = connection?.connection?.calendarName;
  const issues = status?.issues;
  const statusNotice =
    status?.errorCode && (status.errorCode !== 'lesson_attention_required' || !issues?.items.length)
      ? attentionCopy(status.errorCode)
      : status?.state === 'needs_attention' && !issues?.items.length
        ? 'A calendar operation needs review. Check the submitted setup for recovery options.'
        : null;
  const privacyNotice = (
    <p className="calendar-notice calendar-privacy-notice">
      Connecting shares your Google account identity and writable calendar list with ESL Pipeline.
      The selected calendar's event details are stored to sync lessons; invitations share event
      details with recipients when you choose to send them. Access can continue in the background.
      OpenAI API processes selected teaching context; memory rebuilds and profile refreshes can also
      send Calendar-derived lesson start times and internal lesson associations. Separately
      authorized ChatGPT connections receive selected learner context. Disconnecting stops sync but
      keeps stored data and Google authorization. Read the{' '}
      <a
        href="https://eslpipeline.com/privacy/#google-calendar"
        target="_blank"
        rel="noopener noreferrer"
      >
        Privacy Policy (opens in a new tab)
      </a>{' '}
      for details and how to revoke access or request deletion.
    </p>
  );
  const permissionScope = (
    <p className="calendar-help">
      Google grants access to events across your calendars. ESL Pipeline uses only the calendar you
      select.
    </p>
  );
  const privacyDetails = (
    <details className="calendar-v2-disclosure">
      <summary>Calendar access and privacy</summary>
      {privacyNotice}
    </details>
  );
  const panel = (
    <section className="calendar-scheduling-panel" aria-label="Google Calendar scheduling">
      <header className="calendar-header">
        <div className="calendar-heading">
          <span className="calendar-icon">
            <CalendarDays size={21} aria-hidden="true" />
          </span>
          <div>
            <div className="calendar-title-line">
              <h2>Google Calendar</h2>
              {studioV2 && statusPending ? (
                <LoadingPlaceholder label="Checking calendar connection" kind="inline" count={1} />
              ) : (
                <span className="calendar-status" data-state={status?.state} role="status">
                  {status?.state === 'synced' && <Check size={12} aria-hidden="true" />}
                  {stateLabel}
                </span>
              )}
            </div>
            {calendarName || choosingCalendar || !studioV2 ? (
              <p className="calendar-subtitle">
                {choosingCalendar
                  ? connection?.grant?.googleEmail
                  : (calendarName ?? 'Connect a calendar to schedule lessons')}
              </p>
            ) : null}
          </div>
        </div>
        <div className="calendar-header-actions">
          {connected && showSettings ? (
            <button
              className="calendar-button calendar-sync-button"
              type="button"
              disabled={busy || syncInProgress}
              onClick={() => void syncNow()}
            >
              <RefreshCw
                size={15}
                className={syncInProgress ? 'calendar-sync-spinner' : undefined}
                aria-hidden="true"
              />
              {syncInProgress ? 'Syncing…' : 'Sync now'}
            </button>
          ) : connected ? null : choosingCalendar ? (
            calendars.length === 0 ? (
              <button
                className="calendar-button calendar-button-primary"
                type="button"
                disabled={busy}
                onClick={() => void loadCalendars()}
              >
                Choose lesson calendar
              </button>
            ) : null
          ) : canConnect ? (
            <button
              className="calendar-button calendar-button-primary"
              type="button"
              disabled={busy}
              onClick={() => void connect()}
            >
              {status?.state === 'reconnect_required' ? 'Reconnect Google' : 'Connect Google'}
            </button>
          ) : null}
        </div>
      </header>
      {studioV2 && connected && studentId && (hasScheduleView || canLink) ? (
        <div className="calendar-v2-actions" role="group" aria-label="Calendar actions">
          {hasScheduleView && (
            <button
              type="button"
              aria-pressed={activeView === 'schedule'}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) setDrawerView('schedule');
              }}
            >
              <CalendarDays size={16} aria-hidden="true" /> Schedule lesson
            </button>
          )}
          {canLink && (
            <button
              type="button"
              aria-pressed={activeView === 'link'}
              aria-disabled={busy}
              onClick={() => {
                if (busy) return;
                setDrawerView('link');
                if (!unlinkedLoaded) void loadUnlinkedEvents();
              }}
            >
              <Link2 size={16} aria-hidden="true" /> Link existing event
            </button>
          )}
          <button
            type="button"
            aria-pressed={activeView === 'settings'}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) setDrawerView('settings');
            }}
          >
            <Settings2 size={16} aria-hidden="true" /> Calendar settings
          </button>
        </div>
      ) : null}
      {unavailable && (
        <p className="calendar-help">
          {connection.unavailableReason === 'google_calendar_disabled'
            ? 'Google Calendar is turned off in this environment.'
            : 'Google Calendar setup is incomplete.'}
        </p>
      )}
      {!studioV2 && privacyNotice}
      {studioV2 && !connected && canConnect && !choosingCalendar ? permissionScope : null}
      {error ? (
        <p className="calendar-notice calendar-notice-error" role="alert">
          {error}
        </p>
      ) : null}
      {(!studioV2 || activeView === 'settings') && (
        <>
          {statusNotice && <p className="calendar-notice">{statusNotice}</p>}
          {issues && issues.items.length > 0 && (
            <section className="calendar-notice" aria-label="Teaching calendar issues">
              <strong>Teaching calendar issues</strong>
              <ul className="calendar-issue-list">
                {issues.items.map((issue) => (
                  <li key={`${issue.kind}:${issue.id}`}>
                    <strong>{issue.studentName}</strong>
                    {' · '}
                    {issue.startsAt
                      ? formatTutorTime(issue.startsAt, timezone)
                      : issue.kind === 'series'
                        ? 'Recurring series'
                        : 'Linked event'}
                    <p>{attentionCopy(issue.errorCode)}</p>
                    {issue.eventUrl && (
                      <a href={issue.eventUrl} target="_blank" rel="noreferrer">
                        Open in Google
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              {issues.hasMore && <p>Showing the first {issues.items.length} issues.</p>}
            </section>
          )}
        </>
      )}
      {studioV2 && !connected && connection?.enabled && !canConnect ? (
        <p className="calendar-help">Ask a workspace owner to connect Google Calendar.</p>
      ) : null}
      {!studioV2 && !connected ? (
        <div className="calendar-intro">
          <p>
            Google Calendar is required to schedule lessons. Teaching history, homework and billing
            remain available.
          </p>
          <p>
            Google permission covers Calendar events across your calendars; ESL uses only your
            selected lesson calendar.
          </p>
          {connection?.grant ? (
            <p>{connection.grant.googleEmail} · Select a lesson calendar to finish connecting.</p>
          ) : null}
          {connection && !connection.enabled ? (
            <p>
              Calendar scheduling is unavailable. Ask a workspace owner to check the connection.
            </p>
          ) : null}
        </div>
      ) : null}
      {studioV2 && !connected && error && !choosingCalendar && (
        <button
          className="calendar-button"
          type="button"
          disabled={busy}
          onClick={() => void run(refresh)}
        >
          Retry connection check
        </button>
      )}
      {showSettings ? (
        <ConnectionSettings
          className="calendar-connection"
          open={studioV2 ? undefined : !connected}
        >
          {!studioV2 && <summary>Connection settings</summary>}
          <div className="calendar-connection-body">
            {connection?.connection && !choosingCalendar ? (
              <dl className="calendar-connection-facts">
                <div>
                  <dt>Google account</dt>
                  <dd>{connection.connection.googleEmail}</dd>
                </div>
                <div>
                  <dt>Calendar timezone</dt>
                  <dd>{timezoneName(connection.connection.calendarTimezone)}</dd>
                </div>
                {status?.lastSyncedAt ? (
                  <div>
                    <dt>Last successful sync</dt>
                    <dd>{formatTutorTime(status.lastSyncedAt, timezone)}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            {!choosingCalendar && (
              <div className="calendar-actions">
                {!studioV2 && (
                  <button
                    className="calendar-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void run(refresh)}
                  >
                    Refresh status
                  </button>
                )}
                {connected && canConnect ? (
                  <button
                    className="calendar-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void connect()}
                  >
                    Reconnect Google
                  </button>
                ) : null}
                {connection?.enabled && connection.canManage && connection.grant ? (
                  <button
                    className="calendar-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void loadCalendars()}
                  >
                    {studioV2 ? 'Change lesson calendar' : 'Choose lesson calendar'}
                  </button>
                ) : null}
              </div>
            )}
            {calendars.length ? (
              <form
                className={studioV2 ? 'calendar-picker' : undefined}
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await selectLessonCalendar(workspaceId, selectedCalendar, confirmReplacement);
                    setCalendars([]);
                  });
                }}
              >
                {studioV2 ? (
                  <fieldset className="calendar-picker-options" disabled={busy}>
                    <legend>Lesson calendar</legend>
                    <div className="calendar-picker-list">
                      {calendars.map((calendar, index) => (
                        <label className="calendar-picker-option" key={calendar.id}>
                          <input
                            ref={
                              (selectedCalendar ? selectedCalendar === calendar.id : index === 0)
                                ? calendarChoiceRef
                                : undefined
                            }
                            type="radio"
                            name="lesson-calendar"
                            value={calendar.id}
                            checked={selectedCalendar === calendar.id}
                            onChange={() => setSelectedCalendar(calendar.id)}
                            required
                          />
                          <span>
                            <strong>{calendar.summary}</strong>{' '}
                            <small>Time zone: {timezoneName(calendar.timeZone)}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                  <label>
                    Lesson calendar
                    <select
                      required
                      value={selectedCalendar}
                      onChange={(event) => setSelectedCalendar(event.target.value)}
                    >
                      <option value="">Select a writable calendar</option>
                      {calendars.map((calendar) => (
                        <option key={calendar.id} value={calendar.id}>
                          {calendar.summary} · Time zone: {timezoneName(calendar.timeZone)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {connection?.connection ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmReplacement}
                      onChange={(event) => setConfirmReplacement(event.target.checked)}
                    />
                    I understand this replaces the scheduling source; existing lessons and pending
                    work will not be retargeted.
                  </label>
                ) : null}
                <button
                  className={
                    studioV2 ? 'calendar-button calendar-button-primary' : 'calendar-button'
                  }
                  type="submit"
                  disabled={
                    busy ||
                    !selectedCalendar ||
                    (Boolean(connection?.connection) && !confirmReplacement)
                  }
                >
                  Use this calendar
                </button>
              </form>
            ) : null}
            {connected && !studioV2 ? (
              <p className="calendar-help">
                Google permission covers Calendar events across your calendars; ESL uses only your
                selected lesson calendar.
              </p>
            ) : null}
            {!studioV2 && (
              <p className="calendar-help">
                Existing appointments in other calendars remain yours to manage. Recreating them
                here can leave duplicate events visible.
              </p>
            )}
            {connected && connection?.canManage ? (
              <div className="calendar-disconnect">
                <p>
                  {studioV2
                    ? 'Disconnecting stops scheduling and sync.'
                    : 'Disconnecting stops Calendar scheduling and sync. Your lesson history and billing remain available.'}
                </p>
                <button
                  className="calendar-button calendar-button-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => disconnectLessonCalendar(workspaceId))}
                >
                  Disconnect Google
                </button>
              </div>
            ) : null}
            {studioV2 && connected && (
              <>
                {canConnect && permissionScope}
                {privacyDetails}
              </>
            )}
            {choosingCalendar && (
              <div className="calendar-v2-switch-account">
                <button
                  className="calendar-v2-text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void connect()}
                >
                  Use another Google account
                </button>
                {permissionScope}
              </div>
            )}
          </div>
        </ConnectionSettings>
      ) : null}
      {studioV2 && !connected && privacyDetails}
      {studentId && (!studioV2 || !connected || activeView === 'schedule') ? (
        <>
          {!saved && (!studioV2 || canSchedule) ? (
            <div className="calendar-creation">
              <form
                className="calendar-email-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const updated = await updateStudentProfile(studentId, {
                      email: recipient.trim() || null,
                    });
                    setSavedRecipient(updated.email ?? '');
                    setRecipient(updated.email ?? '');
                    setSendInvitation(Boolean(updated.email));
                  });
                }}
              >
                <div className="calendar-section-heading">
                  <h3>Invitations</h3>
                  {!studioV2 && (
                    <p>
                      A student email is optional. You can create lessons without sending an
                      invitation.
                    </p>
                  )}
                </div>
                <label>
                  Student email (optional)
                  <input
                    type="email"
                    maxLength={320}
                    value={recipient}
                    disabled={Boolean(saved)}
                    onChange={(event) => {
                      setRecipient(event.target.value);
                      setSendInvitation(Boolean(event.target.value));
                    }}
                  />
                </label>
                {(!studioV2 || recipient.trim() !== savedRecipient) && (
                  <button
                    className="calendar-button"
                    type="submit"
                    disabled={busy || Boolean(saved)}
                  >
                    Save email
                  </button>
                )}
                {!studioV2 ? (
                  <p>
                    Save a changed email before creating a schedule. Changes apply to future
                    invitations; edit existing guests in Google.
                  </p>
                ) : recipient.trim() !== savedRecipient ? (
                  <p>Save the email before scheduling.</p>
                ) : null}
              </form>
              <form
                className="calendar-lesson-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(submit);
                }}
              >
                <div className="calendar-section-heading">
                  <h3>Create lessons</h3>
                  {!studioV2 && (
                    <p>
                      Each weekly row creates a separate Google series. Edit it later in Google
                      Calendar.
                    </p>
                  )}
                </div>
                <fieldset
                  className="calendar-setup-fields"
                  disabled={!connected || !connection?.canSchedule || busy}
                >
                  <label>
                    Invitation title
                    <input
                      required
                      maxLength={200}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  {!studioV2 && (
                    <p className="calendar-timezone">
                      Tutor timezone: <strong>{timezoneName(timezone)}</strong>
                    </p>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(recipient) && sendInvitation}
                      disabled={!recipient}
                      onChange={(event) => setSendInvitation(event.target.checked)}
                    />
                    Send invitation
                    {recipient ? ` to ${recipient}` : ' (add a student email to invite)'}
                  </label>
                  {slots.map((slot, index) => (
                    <fieldset
                      className="calendar-slot"
                      key={index}
                      aria-label={`Lesson row ${index + 1}`}
                    >
                      <legend>
                        <span>Lesson {index + 1}</span>{' '}
                        {slots.length > 1 ? (
                          <button
                            className="calendar-button"
                            type="button"
                            onClick={() =>
                              setSlots((current) => current.filter((_, i) => i !== index))
                            }
                          >
                            Remove row {index + 1}
                          </button>
                        ) : null}
                      </legend>
                      <label>
                        Repeats
                        <select
                          value={slot.kind}
                          onChange={(event) =>
                            updateSlot(index, {
                              kind: event.target.value as CalendarSlotDto['kind'],
                              weekday: event.target.value === 'weekly' ? 1 : undefined,
                              endDate: undefined,
                            })
                          }
                        >
                          <option value="weekly">Weekly</option>
                          <option value="one_off">One-off</option>
                        </select>
                      </label>
                      {slot.kind === 'weekly' ? (
                        <label>
                          Weekday
                          <select
                            value={slot.weekday}
                            onChange={(event) =>
                              updateSlot(index, { weekday: Number(event.target.value) })
                            }
                          >
                            {DAYS.map((day, weekday) => (
                              <option key={day} value={weekday}>
                                {day}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label>
                        Local time
                        <input
                          required
                          type="time"
                          value={slot.localTime}
                          onChange={(event) => updateSlot(index, { localTime: event.target.value })}
                        />
                      </label>
                      <label>
                        Duration (minutes)
                        <input
                          required
                          type="number"
                          min="1"
                          max="1440"
                          value={slot.durationMinutes}
                          onChange={(event) =>
                            updateSlot(index, { durationMinutes: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label>
                        Start date
                        <input
                          required
                          type="date"
                          value={slot.startDate}
                          onChange={(event) => updateSlot(index, { startDate: event.target.value })}
                        />
                      </label>
                      {slot.kind === 'weekly' ? (
                        <label>
                          End date (optional)
                          <input
                            type="date"
                            min={slot.startDate}
                            value={slot.endDate ?? ''}
                            onChange={(event) =>
                              updateSlot(index, { endDate: event.target.value || undefined })
                            }
                          />
                        </label>
                      ) : null}
                    </fieldset>
                  ))}
                  <button
                    className="calendar-button"
                    type="button"
                    disabled={slots.length >= 20}
                    onClick={() =>
                      setSlots((current) => [
                        ...current,
                        {
                          kind: 'weekly',
                          weekday: 5,
                          localTime: '09:00',
                          startDate: dateInputInTimezone(new Date(), timezone),
                          durationMinutes: defaultDurationMinutes,
                        },
                      ])
                    }
                  >
                    Add weekly row
                  </button>
                </fieldset>
                <button
                  className="calendar-button calendar-button-primary"
                  type="submit"
                  disabled={
                    busy ||
                    !connected ||
                    !connection?.canSchedule ||
                    recipient.trim() !== savedRecipient
                  }
                >
                  Create in Google
                </button>
              </form>
            </div>
          ) : null}
          {saved ? (
            <div className="calendar-submitted">
              <div className="calendar-section-heading">
                <h3>Submitted lesson setup</h3>
                <p>{saved.request.title}</p>
              </div>
              <p className="calendar-help">
                Time zone: {timezoneName(saved.request.timezone)} ·{' '}
                {saved.request.sendInvitation ? 'Invitation requested' : 'No invitation requested'}
              </p>
              <ol className="calendar-submitted-rows" aria-label="Submitted lesson rows">
                {saved.request.slots.map((slot, index) => (
                  <li key={index}>
                    <strong>
                      {slot.kind === 'weekly' ? DAYS[slot.weekday ?? 0] : 'One-off'} ·{' '}
                      {slot.localTime}
                    </strong>
                    <span>
                      {slot.durationMinutes} min · From {slot.startDate}
                      {slot.endDate ? ` through ${slot.endDate}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="calendar-help">
                These submitted choices are fixed. Retries reuse the same request.
              </p>
              {!saved.setupId ? (
                <div className="calendar-notice">
                  <p>
                    Google acceptance is unconfirmed. Retry this same setup before starting another.
                  </p>
                  <button
                    className="calendar-button calendar-button-primary"
                    type="button"
                    disabled={busy || !connected || !connection?.canSchedule}
                    onClick={() => void run(submit)}
                  >
                    Retry submitted setup
                  </button>
                </div>
              ) : (
                <button
                  className="calendar-button"
                  type="button"
                  disabled={
                    busy ||
                    !setup ||
                    setup.operations.some((op) =>
                      ['pending', 'running', 'retry_wait'].includes(op.state),
                    )
                  }
                  onClick={() => {
                    localStorage.removeItem(storageKey);
                    setSaved(null);
                    setSetup(null);
                  }}
                >
                  Start another setup
                </button>
              )}
            </div>
          ) : null}
          {setup ? (
            <ol className="calendar-outcomes" aria-label="Per-series outcomes">
              {setup.operations
                .filter((op) => op.kind !== 'setup')
                .map((op) => (
                  <li key={op.id}>
                    <strong>
                      Lesson row {(op.slotIndex ?? 0) + 1}: {outcomeLabels[op.state]}
                    </strong>
                    {op.errorCode ? (
                      <p className="calendar-help">{attentionCopy(op.errorCode)}</p>
                    ) : null}
                    {op.eventUrl ? (
                      <a href={op.eventUrl} target="_blank" rel="noreferrer">
                        Open in Google
                      </a>
                    ) : null}
                    {['needs_review', 'retry_wait'].includes(op.state) ? (
                      <button
                        className="calendar-button"
                        type="button"
                        disabled={busy}
                        onClick={() => void run(() => retryCalendarOperation(workspaceId, op.id))}
                      >
                        Retry row {(op.slotIndex ?? 0) + 1}
                      </button>
                    ) : null}
                    {connection?.canManage && ['needs_review', 'retry_wait'].includes(op.state) ? (
                      <button
                        className="calendar-button"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () =>
                            setReview(await reviewCalendarOperation(workspaceId, op.id)),
                          )
                        }
                      >
                        Review row {(op.slotIndex ?? 0) + 1} for adoption
                      </button>
                    ) : null}
                  </li>
                ))}
            </ol>
          ) : null}
          {review ? (
            <div
              className="calendar-review"
              role="region"
              aria-label="Review captured Calendar operation"
            >
              <h3>Review before taking responsibility</h3>
              <p>{review.title}</p>
              <p>
                {formatTutorTime(review.startsAt, timezone)} –{' '}
                {formatTutorTime(review.endsAt, timezone)}
              </p>
              <p>{review.recurrence?.join(', ') || 'One-off lesson'}</p>
              <p>Invitation recipient: {review.invitationRecipient || 'No invitation'}</p>
              <p>
                This retries the captured operation with its original event identity and invitation
                choices.
              </p>
              <button
                className="calendar-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await adoptCalendarOperation(workspaceId, review.id, review.requestHash);
                    setReview(null);
                  })
                }
              >
                Confirm and adopt operation
              </button>
              <button className="calendar-button" type="button" onClick={() => setReview(null)}>
                Close review
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {studentId && (!studioV2 || (canLink && activeView === 'link')) && (
        <CalendarAssociation
          className="calendar-association"
          aria-label={studioV2 ? 'Unlinked Google events' : undefined}
        >
          {!studioV2 && <summary>Associate an existing Google event</summary>}
          {!studioV2 && (
            <p>
              Select the exact event for this student. Titles and guest emails never determine the
              student automatically.
            </p>
          )}
          {(!studioV2 || (!unlinkedLoaded && !busy)) && (
            <button
              className="calendar-button"
              type="button"
              disabled={busy || !connected || !connection?.canManage}
              onClick={() => void loadUnlinkedEvents()}
            >
              {studioV2 ? 'Retry loading events' : 'Load unlinked events'}
            </button>
          )}
          {studioV2 && busy && !unlinkedLoaded && (
            <LoadingPlaceholder label="Loading Google events" />
          )}
          {studioV2 && linkedEventTitle && (
            <p className="calendar-v2-linked" role="status">
              Linked “{linkedEventTitle}” to {studentName}.
            </p>
          )}
          {unlinkedLoaded && !unlinked.length && !unlinkedNextPageToken ? (
            <p>
              {studioV2 ? 'No unlinked Google events.' : 'No unlinked events in the loaded pages.'}
            </p>
          ) : null}
          {unlinked.map((event) => (
            <div className="calendar-unlinked-row" key={event.id}>
              {studioV2 ? (
                <div className="calendar-v2-event-label">
                  <strong>{event.title}</strong>
                  <span>
                    {event.startsAt
                      ? formatTutorTime(event.startsAt, timezone)
                      : 'Unsupported time'}
                  </span>
                </div>
              ) : (
                <span>
                  {event.title} ·{' '}
                  {event.startsAt ? formatTutorTime(event.startsAt, timezone) : 'Unsupported time'}
                </span>
              )}
              <button
                className="calendar-button"
                type="button"
                disabled={busy || !connection?.canManage}
                aria-label={studioV2 ? `Link ${event.title} to ${studentName}` : undefined}
                onClick={() =>
                  void run(async () => {
                    await bindCalendarEvent(workspaceId, studentId, event.id);
                    setUnlinked((current) => current.filter((item) => item.id !== event.id));
                    if (studioV2) setLinkedEventTitle(event.title);
                  })
                }
              >
                {studioV2 ? 'Link event' : `Associate with ${studentName}`}
              </button>
            </div>
          ))}
          {unlinkedNextPageToken ? (
            <button
              className="calendar-button"
              type="button"
              disabled={busy || !connected || !connection?.canManage}
              onClick={() =>
                void run(async () => {
                  const page = await getCalendarUnlinkedEvents(workspaceId, unlinkedNextPageToken);
                  setUnlinked((current) => [
                    ...new Map(
                      [...current, ...page.events].map((event) => [event.id, event]),
                    ).values(),
                  ]);
                  setUnlinkedNextPageToken(page.nextPageToken);
                })
              }
            >
              Load more events
            </button>
          ) : null}
        </CalendarAssociation>
      )}
      {studentId && !studioV2 ? (
        <p className="calendar-footer">
          Edit lesson times, recurrence, guests and cancellations in Google. Google sends
          invitations; inbox delivery is not guaranteed.
        </p>
      ) : null}
    </section>
  );
  if (!studioV2) return panel;
  return (
    <div id="teaching-calendar" className="calendar-v2-entry">
      <div className="calendar-v2-entry-info">
        <span className="calendar-v2-dot" data-state={status?.state} />
        <strong>Teaching calendar</strong>
        {statusPending ? (
          <LoadingPlaceholder label="Checking calendar connection" kind="inline" count={1} />
        ) : (
          <span role="status">{error ? 'Needs attention' : stateLabel}</span>
        )}
      </div>
      <div className="calendar-v2-entry-actions">
        <button
          ref={manageRef}
          type="button"
          className="product-button product-button--quiet"
          onClick={(event) => {
            drawerTrigger.current = event.currentTarget;
            setDrawerView(needsAttention ? 'settings' : 'schedule');
            setExpanded(true);
          }}
        >
          {needsAttention ? 'Review calendar issues' : 'Manage'} <span aria-hidden="true">→</span>
        </button>
        {studentId && canSchedule && (
          <button
            type="button"
            className="product-button product-button--primary"
            aria-label={studentName ? `Schedule lesson for ${studentName}` : 'Schedule a lesson'}
            onClick={(event) => {
              drawerTrigger.current = event.currentTarget;
              setDrawerView('schedule');
              setExpanded(true);
            }}
          >
            <CalendarDays size={16} aria-hidden="true" />
            Schedule lesson
          </button>
        )}
      </div>
      {presentationActive && expanded ? (
        <StudioV2Dialog
          title={
            studentId && connected && activeView === 'link'
              ? 'Link existing event'
              : studentId && (connected ? activeView === 'schedule' : saved)
                ? 'Schedule lesson'
                : connected
                  ? 'Calendar settings'
                  : 'Teaching calendar'
          }
          drawer
          closeDisabled={busy}
          onClose={closeDrawer}
        >
          <div className="calendar-v2-drawer">
            {studentName && (canSchedule || saved) ? (
              <div className="calendar-v2-context">
                <strong>{studentName}</strong>
                <span>Time zone: {timezoneName(timezone)}</span>
              </div>
            ) : null}
            {panel}
          </div>
        </StudioV2Dialog>
      ) : null}
    </div>
  );
}

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
}
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Calendar action failed. Try again.';

/** Calendar failures have their own state: they never replace the teaching ledger. */
export function CalendarSchedulingPanel({
  workspaceId,
  timezone,
  studentId,
  studentName,
  email,
  defaultDurationMinutes = 60,
  onLedgerRefresh,
}: Props) {
  const storageKey = `calendar-setup:${workspaceId}:${studentId ?? 'workspace'}`;
  const [connection, setConnection] = useState<CalendarConnectionStatusDto | null>(null);
  const [status, setStatus] = useState<CalendarSchedulingStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const [saved, setSaved] = useState<SavedSetup | null>(null);
  const [setup, setSetup] = useState<CalendarSetupDto | null>(null);
  const [review, setReview] = useState<CalendarOperationReviewDto | null>(null);
  const [unlinked, setUnlinked] = useState<CalendarUnlinkedEventDto[]>([]);
  const [unlinkedNextPageToken, setUnlinkedNextPageToken] = useState<string | null>(null);
  const [unlinkedLoaded, setUnlinkedLoaded] = useState(false);
  useEffect(() => {
    setUnlinked([]);
    setUnlinkedNextPageToken(null);
    setUnlinkedLoaded(false);
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
  const submit = async () => {
    // Persist before network admission. A timeout/reload must reuse the immutable request.
    const intent = saved ?? {
      key: crypto.randomUUID(),
      request: { title, timezone, sendInvitation: Boolean(recipient) && sendInvitation, slots },
    };
    localStorage.setItem(storageKey, JSON.stringify(intent));
    setSaved(intent);
    const result = await createCalendarSetup(workspaceId, studentId!, intent.request, intent.key);
    const persisted = { ...intent, setupId: result.id };
    localStorage.setItem(storageKey, JSON.stringify(persisted));
    setSaved(persisted);
    setSetup(result);
  };
  const updateSlot = (index: number, patch: Partial<CalendarSlotDto>) =>
    setSlots((current) => current.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  const connected = connection?.connection?.status === 'connected';
  return (
    <section
      className="student-schedule-billing-panel calendar-scheduling-panel"
      aria-label="Google Calendar scheduling"
    >
      <h2>Google Calendar</h2>
      <p>
        Google permission covers Calendar events across your calendars; ESL uses only your selected
        lesson calendar.
      </p>
      <p>
        Existing appointments in other calendars remain yours to manage. Recreating them here can
        leave duplicate events visible.
      </p>
      <p>
        Google Calendar is required to schedule lessons. Teaching history, homework and billing
        remain available.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <p role="status">
        {status
          ? {
              disconnected: 'Disconnected',
              reconnect_required: 'Reconnect required',
              syncing: 'Syncing',
              synced: 'Synced',
              needs_attention: 'Needs attention',
            }[status.state]
          : 'Checking Calendar connection…'}
      </p>
      {connection?.connection ? (
        <p>
          {connection.connection.googleEmail} · {connection.connection.calendarName} ·{' '}
          {connection.connection.calendarTimezone}
        </p>
      ) : connection?.grant ? (
        <p>{connection.grant.googleEmail} · Select a lesson calendar to finish connecting.</p>
      ) : null}
      {status?.lastSyncedAt ? (
        <p>
          Last successful sync:{' '}
          {new Date(status.lastSyncedAt).toLocaleString('en-US', { timeZone: timezone })}
        </p>
      ) : null}
      {status?.errorCode ? <p>Needs attention: {status.errorCode}</p> : null}
      <button type="button" disabled={busy} onClick={() => void run(refresh)}>
        Refresh status
      </button>
      {connection?.enabled ? (
        <>
          {connection.canManage ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await beginCalendarConnect(workspaceId);
                  window.location.assign(result.authorizationUrl);
                })
              }
            >
              {connected ? 'Reconnect Google' : 'Connect Google'}
            </button>
          ) : null}
          {connection.canManage && connection.grant ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setCalendars((await getLessonCalendars(workspaceId)).calendars),
                )
              }
            >
              Choose lesson calendar
            </button>
          ) : null}
          {connected ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => requestCalendarSync(workspaceId))}
              >
                Sync now
              </button>
              {connection.canManage ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => disconnectLessonCalendar(workspaceId))}
                >
                  Disconnect Google
                </button>
              ) : null}
            </>
          ) : null}
        </>
      ) : connection ? (
        <p>
          Calendar scheduling is unavailable. Existing lessons and other teaching tools remain
          usable.
        </p>
      ) : null}
      {calendars.length ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await selectLessonCalendar(workspaceId, selectedCalendar, confirmReplacement);
              setCalendars([]);
            });
          }}
        >
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
                  {calendar.summary} ({calendar.timeZone})
                </option>
              ))}
            </select>
          </label>
          {connection?.connection ? (
            <label>
              <input
                type="checkbox"
                checked={confirmReplacement}
                onChange={(event) => setConfirmReplacement(event.target.checked)}
              />
              I understand this replaces the scheduling source; existing lessons and pending work
              will not be retargeted.
            </label>
          ) : null}
          <button
            type="submit"
            disabled={
              busy || !selectedCalendar || (Boolean(connection?.connection) && !confirmReplacement)
            }
          >
            Use this calendar
          </button>
        </form>
      ) : null}
      {studentId ? (
        <>
          <form
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
            <button type="submit" disabled={busy || Boolean(saved)}>
              Save email
            </button>
            <p>
              Save a changed email before creating a schedule. Changes apply to future invitations;
              edit existing guests in Google.
            </p>
          </form>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(submit);
            }}
          >
            <h3>Create lessons</h3>
            <fieldset disabled={!connected || !connection?.canSchedule || busy || Boolean(saved)}>
              <label>
                Invitation title
                <input
                  required
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <p>Timezone: {timezone}. Each weekly row creates an independent Google series.</p>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(recipient) && sendInvitation}
                  disabled={!recipient}
                  onChange={(event) => setSendInvitation(event.target.checked)}
                />
                Send invitation{recipient ? ` to ${recipient}` : ' (add a student email to invite)'}
              </label>
              {slots.map((slot, index) => (
                <fieldset key={index} aria-label={`Lesson row ${index + 1}`}>
                  <legend>Lesson {index + 1}</legend>
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
                  {slots.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setSlots((current) => current.filter((_, i) => i !== index))}
                    >
                      Remove row {index + 1}
                    </button>
                  ) : null}
                </fieldset>
              ))}
              <button
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
              type="submit"
              disabled={
                busy ||
                !connected ||
                !connection?.canSchedule ||
                Boolean(saved?.setupId) ||
                (!saved && recipient.trim() !== savedRecipient)
              }
            >
              {saved && !saved.setupId ? 'Retry submitted setup' : 'Create in Google'}
            </button>
          </form>
          {saved ? (
            <div>
              <p>
                Submitted setup retained for recovery. Its invitation choices and lesson rows are
                fixed.
              </p>
              {!saved.setupId ? (
                <p>
                  Google acceptance is unconfirmed. Retry this same setup before starting another.
                </p>
              ) : (
                <button
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
            <ol aria-label="Per-series outcomes">
              {setup.operations
                .filter((op) => op.kind !== 'setup')
                .map((op) => (
                  <li key={op.id}>
                    Lesson row {(op.slotIndex ?? 0) + 1}: {op.state.replaceAll('_', ' ')}
                    {op.errorCode ? ` — ${op.errorCode}` : ''}
                    {op.eventUrl ? (
                      <a href={op.eventUrl} target="_blank" rel="noreferrer">
                        Open in Google
                      </a>
                    ) : null}
                    {['needs_review', 'retry_wait'].includes(op.state) ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(() => retryCalendarOperation(workspaceId, op.id))}
                      >
                        Retry row {(op.slotIndex ?? 0) + 1}
                      </button>
                    ) : null}
                    {connection?.canManage && ['needs_review', 'retry_wait'].includes(op.state) ? (
                      <button
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
            <div role="region" aria-label="Review captured Calendar operation">
              <h3>Review before taking responsibility</h3>
              <p>{review.title}</p>
              <p>
                {review.startsAt} – {review.endsAt} · {review.timezone}
              </p>
              <p>{review.recurrence?.join(', ') || 'One-off lesson'}</p>
              <p>Invitation recipient: {review.invitationRecipient || 'No invitation'}</p>
              <p>
                This retries the captured operation with its original event identity and invitation
                choices.
              </p>
              <button
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
              <button type="button" onClick={() => setReview(null)}>
                Close review
              </button>
            </div>
          ) : null}
          <details>
            <summary>Associate an existing Google event</summary>
            <p>
              Select the exact event for this student. Titles and guest emails never determine the
              student automatically.
            </p>
            <button
              type="button"
              disabled={busy || !connected || !connection?.canManage}
              onClick={() =>
                void run(async () => {
                  const page = await getCalendarUnlinkedEvents(workspaceId);
                  setUnlinked(page.events);
                  setUnlinkedNextPageToken(page.nextPageToken);
                  setUnlinkedLoaded(true);
                })
              }
            >
              Load unlinked events
            </button>
            {unlinkedLoaded && !unlinked.length ? (
              <p>No unlinked events in the loaded pages.</p>
            ) : null}
            {unlinked.map((event) => (
              <div key={event.id}>
                <span>
                  {event.title} · {event.startsAt ?? 'Unsupported time'}
                </span>
                <button
                  type="button"
                  disabled={busy || !connection?.canManage}
                  onClick={() =>
                    void run(async () => {
                      await bindCalendarEvent(workspaceId, studentId, event.id);
                      setUnlinked((current) => current.filter((item) => item.id !== event.id));
                    })
                  }
                >
                  Associate with {studentName}
                </button>
              </div>
            ))}
            {unlinkedNextPageToken ? (
              <button
                type="button"
                disabled={busy || !connected || !connection?.canManage}
                onClick={() =>
                  void run(async () => {
                    const page = await getCalendarUnlinkedEvents(
                      workspaceId,
                      unlinkedNextPageToken,
                    );
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
          </details>
        </>
      ) : null}
      <p>
        After creation, edit timing, recurrence, guests and cancellations in Google. Google sends
        invitations; inbox delivery is not guaranteed.
      </p>
    </section>
  );
}

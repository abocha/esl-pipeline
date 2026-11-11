import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import type { StudentActivityItem, StudentActivityResponse } from '@esl-pipeline/contracts';

import { useWorkspaceSettings, useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import { getStudentActivity } from '../../utils/api';
import { timezoneName } from '../../utils/timezones';
import { useStudioV2 } from '../studio-v2/StudioV2Context';
import { LoadingPlaceholder } from '../system/LoadingPlaceholder';
import { useStudentAreaContext } from './StudentAreaContext';
import './StudentAreaDesignSystem.css';
import './StudentHistoryPage.css';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'lessons', label: 'Lessons & homework' },
  { value: 'profile', label: 'Profile' },
  { value: 'billing', label: 'Payments & credits' },
] as const;
type ActivityFilter = (typeof FILTERS)[number]['value'];

function activityDestination(href: string): 'internal' | 'external' | null {
  if (href.startsWith('/') && !href.startsWith('//')) return 'internal';
  try {
    return ['https:', 'http:'].includes(new URL(href).protocol) ? 'external' : null;
  } catch {
    return null;
  }
}

function activityHref(
  href: string,
  item: StudentActivityItem,
  studentId: string,
  studioV2: boolean,
): string {
  if (!studioV2 || !href.startsWith('/') || href.startsWith('//')) return href;

  const pathEnd = href.search(/[?#]/);
  const pathname = pathEnd < 0 ? href : href.slice(0, pathEnd);
  const studentPath = `/students/${encodeURIComponent(studentId)}`;
  if (pathname !== `${studentPath}/schedule-billing`) return href;

  const section = item.category === 'billing' ? 'billing' : 'schedule';
  return `${studentPath}/${section}${pathEnd < 0 ? '' : href.slice(pathEnd)}`;
}

function eventDate(value: string, timezone: string, includeTime = false): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unknown';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: dateOnly ? 'UTC' : timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(includeTime && !dateOnly ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(date);
}

function ActivityRow({
  item,
  timezone,
  studentId,
  studioV2,
}: {
  item: StudentActivityItem;
  timezone: string;
  studentId: string;
  studioV2: boolean;
}) {
  const actor =
    item.actor?.label ??
    (item.actor?.kind === 'system' ? 'Automatic' : item.actor?.kind === 'user' ? 'Tutor' : null);
  const receivedDate =
    item.type.startsWith('payment_') &&
    item.effectiveAt &&
    item.summary === `Received ${item.effectiveAt}`
      ? item.effectiveAt
      : null;
  const summary = receivedDate ? `Received ${eventDate(receivedDate, timezone)}` : item.summary;
  const effectiveAt = receivedDate ? null : item.effectiveAt;
  const details = receivedDate
    ? item.details.filter(
        (detail) => detail.label !== 'Received date' || detail.value !== receivedDate,
      )
    : item.details;
  return (
    <li className="student-activity-row">
      <time dateTime={item.occurredAt}>{eventDate(item.occurredAt, timezone, true)}</time>
      <div className="student-activity-content">
        <h3>{item.subject}</h3>
        {summary ? <p>{summary}</p> : null}
        {item.effects?.length ? (
          <dl className="student-activity-effects">
            {item.effects.map((effect) => (
              <div key={`${effect.label}:${effect.value}`}>
                <dt>{effect.label}</dt>
                <dd>{effect.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="student-activity-row-actions">
          {item.links.map((link) => {
            const href = activityHref(link.href, item, studentId, studioV2);
            const destination = activityDestination(href);
            const name = `${link.label}: ${item.subject}`;
            return destination === 'internal' ? (
              <Link key={link.href} to={href} aria-label={name}>
                {link.label}
              </Link>
            ) : destination === 'external' ? (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                aria-label={name}
              >
                {link.label}
              </a>
            ) : null;
          })}
          {actor || effectiveAt || details.length ? (
            <details>
              <summary aria-label={`Details: ${item.subject}`}>Details</summary>
              <dl className="student-activity-details">
                {actor ? (
                  <div>
                    <dt>Actor</dt>
                    <dd>{actor}</dd>
                  </div>
                ) : null}
                {effectiveAt ? (
                  <div>
                    <dt>Effective date</dt>
                    <dd>{eventDate(effectiveAt, timezone, true)}</dd>
                  </div>
                ) : null}
                {details.map((detail) => (
                  <div key={`${detail.label}:${detail.value}`}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function StudentHistoryPage() {
  const studioV2 = useStudioV2();
  const tutorTimezone = useWorkspaceTimezone();
  const { reconcileTimezone } = useWorkspaceSettings();
  const { studentId, studentLoading, studentError } = useStudentAreaContext();
  const [search, setSearch] = useSearchParams();
  const requestedFilter = search.get('activity') ?? 'all';
  const category: ActivityFilter =
    FILTERS.find((filter) => filter.value === requestedFilter)?.value ?? 'all';
  const validDate = (value: string | null) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') ? value! : '';
  const from = validDate(search.get('from'));
  const to = validDate(search.get('to'));
  const invalidRange = Boolean(from && to && from > to);
  const scopeKey = JSON.stringify([studentId, category, from, to, tutorTimezone]);
  const [loaded, setLoaded] = useState<{ key: string; data: StudentActivityResponse } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ key: string; message: string; cursor?: string } | null>(
    null,
  );
  const latestRequest = useRef(0);
  const data = loaded?.key === scopeKey ? loaded.data : null;
  const error = failure?.key === scopeKey ? failure.message : null;
  const failedCursor = failure?.key === scopeKey ? failure.cursor : undefined;

  const loadPage = useCallback(
    async (cursor?: string) => {
      const request = ++latestRequest.current;
      setLoading(true);
      setFailure(null);
      try {
        const next = await getStudentActivity(studentId, {
          category,
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          limit: 30,
          ...(cursor ? { cursor } : {}),
        });
        if (latestRequest.current !== request) return;
        await reconcileTimezone(next.timezone);
        if (latestRequest.current !== request) return;
        setLoaded((current) => {
          const items =
            cursor && current?.key === scopeKey
              ? [
                  ...new Map(
                    [...current.data.items, ...next.items].map((item) => [item.id, item]),
                  ).values(),
                ]
              : next.items;
          return { key: scopeKey, data: { ...next, items } };
        });
      } catch (cause) {
        if (latestRequest.current !== request) return;
        setFailure({
          key: scopeKey,
          message: cause instanceof Error ? cause.message : 'Activity could not be loaded.',
          cursor,
        });
      } finally {
        if (latestRequest.current === request) setLoading(false);
      }
    },
    [studentId, category, from, to, scopeKey, reconcileTimezone],
  );

  useEffect(() => {
    if (!studentId || studentLoading || studentError) return;
    if (invalidRange) {
      setLoading(false);
      return;
    }
    void loadPage();
    return () => {
      latestRequest.current += 1;
    };
  }, [loadPage, studentId, studentLoading, studentError, invalidRange]);

  const setFilter = (name: string, value: string) => {
    setSearch((current) => {
      const next = new URLSearchParams(current);
      if (value && value !== 'all') next.set(name, value);
      else next.delete(name);
      return next;
    });
  };

  const filtered = category !== 'all' || Boolean(from || to);
  const pending = Boolean(studentId) && !studentError && !invalidRange && !data && !error;
  const displayedTimezone = tutorTimezone ?? data?.timezone;
  return (
    <section
      className={`student-activity-page${studioV2 ? ' student-v2' : ''}`}
      aria-label="Student history"
      aria-busy={pending || (Boolean(data) && loading)}
    >
      <header className="student-activity-heading">
        <h2>History</h2>
        <div className="student-activity-heading-actions">
          {displayedTimezone ? (
            <span
              className="student-activity-timezone"
              title="Activity dates use the workspace timezone"
            >
              Time zone: {timezoneName(displayedTimezone)}
            </span>
          ) : null}
          <button
            type="button"
            className="student-area-icon-button"
            onClick={() => void loadPage()}
            disabled={loading || studentLoading || Boolean(studentError) || invalidRange}
            aria-label="Refresh history"
            title="Refresh history"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="student-activity-toolbar">
        <div role="group" aria-label="Activity type" className="student-activity-filters">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={category === filter.value}
              onClick={() => setFilter('activity', filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="student-activity-dates" role="group" aria-label="Activity date range">
          <label>
            From
            <input
              type="date"
              name="from"
              value={from}
              max={to || undefined}
              onChange={(event) => setFilter('from', event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              name="to"
              value={to}
              min={from || undefined}
              onChange={(event) => setFilter('to', event.target.value)}
            />
          </label>
          {filtered ? (
            <button
              type="button"
              onClick={() =>
                setSearch((current) => {
                  const next = new URLSearchParams(current);
                  next.delete('activity');
                  next.delete('from');
                  next.delete('to');
                  return next;
                })
              }
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>
      {invalidRange ? <p role="alert">Choose an end date on or after the start date.</p> : null}
      {studentError ? (
        <p role="alert">{studentError}</p>
      ) : !studentId ? (
        <p role="alert">Student ID is required.</p>
      ) : pending ? (
        <LoadingPlaceholder label="Loading student history" />
      ) : (
        <>
          {error ? (
            <div className="student-activity-error">
              <p role="alert">
                {error}
                {data ? ' Previously loaded activity is still shown.' : ''}
              </p>
              <button type="button" disabled={loading} onClick={() => void loadPage(failedCursor)}>
                {failedCursor ? 'Retry loading older activity' : 'Retry history'}
              </button>
            </div>
          ) : null}
          {data ? (
            <>
              {data.items.length ? (
                <ol className="student-activity-list">
                  {data.items.map((item) => (
                    <ActivityRow
                      key={item.id}
                      item={item}
                      timezone={tutorTimezone ?? data.timezone}
                      studentId={studentId}
                      studioV2={studioV2}
                    />
                  ))}
                </ol>
              ) : (
                <div className="student-activity-empty">
                  <h3>{filtered ? 'No matching activity' : 'No history yet'}</h3>
                  <p>
                    {filtered
                      ? 'No activity was found for these filters.'
                      : 'This student has no activity yet.'}
                  </p>
                </div>
              )}
              {data.nextCursor && !error ? (
                <button
                  className="student-activity-load-more"
                  type="button"
                  disabled={loading}
                  onClick={() => void loadPage(data.nextCursor!)}
                >
                  Load older activity
                </button>
              ) : null}
            </>
          ) : error ? (
            <div className="student-activity-empty">
              <h3>History unavailable</h3>
              <p>Existing activity is unknown. Try loading it again.</p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

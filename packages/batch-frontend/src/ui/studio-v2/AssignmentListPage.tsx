import { ArrowRight, FileText, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import {
  type AssignmentSession,
  fetchStudentOptions,
  type JobStatus,
  listAssignmentSessions,
  listUserJobs,
  type StudentOption,
} from '../../utils/api';
import type { RecentAssignmentItem } from '../minimal/MinimalAssignment.entry-state';
import {
  buildRecentAssignmentItems,
  buildRecentAssignmentLineages,
  formatResumeTimeLabel,
} from '../minimal/MinimalAssignment.resume-presentation';
import { LoadingPlaceholder } from '../system/LoadingPlaceholder';
import { ProductButton } from '../system/ProductButton';

import './AssignmentListPage.css';

const PAGE_SIZE = 20;
type Filter = 'all' | 'unfinished' | 'published' | 'transcript';

interface AssignmentListData {
  active: AssignmentSession[];
  activeTotal: number;
  activeOffset: number;
  history: AssignmentSession[];
  historyTotal: number;
  historyOffset: number;
  jobs: JobStatus[];
  jobsTotal: number;
  jobsOffset: number;
  students: StudentOption[];
}

export default function AssignmentListPage() {
  const timezone = useWorkspaceTimezone();
  const [data, setData] = useState<AssignmentListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [params, setParams] = useSearchParams();
  const rawFilter = params.get('status');
  const filter: Filter =
    rawFilter === 'unfinished' || rawFilter === 'published' || rawFilter === 'transcript'
      ? rawFilter
      : 'all';
  const studentId = params.get('student') ?? '';
  const query = params.get('q') ?? '';
  const updateFilter = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value && value !== 'all') next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const generation = useRef(0);
  const morePending = useRef<number | null>(null);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(false);
    morePending.current = null;
    setLoadingMore(false);
    try {
      const [active, history, jobs, students] = await Promise.all([
        listAssignmentSessions(PAGE_SIZE, 'active', 0),
        listAssignmentSessions(PAGE_SIZE, 'history', 0),
        listUserJobs({ limit: PAGE_SIZE, offset: 0 }),
        fetchStudentOptions(),
      ]);
      if (request !== generation.current) return;
      setData({
        active: active.sessions,
        activeTotal: active.total,
        activeOffset: active.sessions.length,
        history: history.sessions,
        historyTotal: history.total,
        historyOffset: history.sessions.length,
        jobs: jobs.jobs,
        jobsTotal: jobs.total,
        jobsOffset: jobs.jobs.length,
        students: students.students,
      });
      setMoreError(false);
    } catch {
      if (request === generation.current) setError(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    return () => {
      generation.current += 1;
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  const loadMore = async () => {
    if (!data || loading || morePending.current !== null) return;
    const request = generation.current;
    morePending.current = request;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const [active, history, jobs] = await Promise.all([
        data.activeOffset < data.activeTotal
          ? listAssignmentSessions(PAGE_SIZE, 'active', data.activeOffset)
          : Promise.resolve(null),
        data.historyOffset < data.historyTotal
          ? listAssignmentSessions(PAGE_SIZE, 'history', data.historyOffset)
          : Promise.resolve(null),
        data.jobsOffset < data.jobsTotal
          ? listUserJobs({ limit: PAGE_SIZE, offset: data.jobsOffset })
          : Promise.resolve(null),
      ]);
      if (request !== generation.current) return;
      setData((current) => {
        if (!current) return current;
        const activeById = new Map(current.active.map((session) => [session.id, session]));
        for (const session of active?.sessions ?? []) activeById.set(session.id, session);
        const historyById = new Map(current.history.map((session) => [session.id, session]));
        for (const session of history?.sessions ?? []) historyById.set(session.id, session);
        const jobsById = new Map(current.jobs.map((job) => [job.jobId, job]));
        for (const job of jobs?.jobs ?? []) jobsById.set(job.jobId, job);
        return {
          ...current,
          active: [...activeById.values()],
          activeTotal: active?.total ?? current.activeTotal,
          activeOffset: current.activeOffset + (active?.sessions.length ?? 0),
          history: [...historyById.values()],
          historyTotal: history?.total ?? current.historyTotal,
          historyOffset: current.historyOffset + (history?.sessions.length ?? 0),
          jobs: [...jobsById.values()],
          jobsTotal: jobs?.total ?? current.jobsTotal,
          jobsOffset: current.jobsOffset + (jobs?.jobs.length ?? 0),
        };
      });
    } catch {
      if (request === generation.current) setMoreError(true);
    } finally {
      if (morePending.current === request) morePending.current = null;
      if (request === generation.current) setLoadingMore(false);
    }
  };

  const { lineages, sessionsById, ownerByItemId } = useMemo(() => {
    // History can contain a promoted transcript. Current markers, never finish history,
    // determine whether it is still a transcript-only lesson.
    const sessionsById = new Map(data?.history.map((session) => [session.id, session]));
    for (const session of data?.active ?? []) {
      const known = sessionsById.get(session.id);
      if (!known || session.revision >= known.revision) sessionsById.set(session.id, session);
    }
    const jobsById = new Map(data?.jobs.map((job) => [job.jobId, job]));
    const ownerByItemId = new Map<string, string>();
    const timeByItemId = new Map<string, string>();
    for (const session of sessionsById.values()) {
      const id = session.confirmedStep === 'share' ? session.shareJobId : `session:${session.id}`;
      if (id) {
        ownerByItemId.set(id, session.studentId);
        timeByItemId.set(id, session.updatedAt);
      }
    }
    const names = new Map(data?.students.map((student) => [student.id, student.name]));
    for (const job of data?.jobs ?? []) {
      if (job.studentId) ownerByItemId.set(job.jobId, job.studentId);
      timeByItemId.set(job.jobId, job.finishedAt ?? job.updatedAt ?? job.createdAt);
      if (job.studentId && job.studentName && !names.has(job.studentId))
        names.set(job.studentId, job.studentName);
    }
    const items = buildRecentAssignmentItems(
      [...sessionsById.values()].filter((session) => session.confirmedStep !== 'share'),
      data?.jobs ?? [],
      '',
      names,
      timezone,
    );
    // Completed sessions outside the loaded job window still have an exact owner link,
    // but their existence does not prove publication success or a handout URL.
    for (const session of sessionsById.values()) {
      if (
        session.confirmedStep !== 'share' ||
        !session.shareJobId ||
        jobsById.has(session.shareJobId)
      )
        continue;
      items.push({
        id: session.shareJobId,
        kind: 'job',
        sourceJobId: null,
        learnerName: names.get(session.studentId) ?? 'Saved assignment',
        recoveryAnchor: null,
        activityLabel: 'Assignment submitted for publication',
        outcomeLabel: 'Open for publication status',
        timeLabel: formatResumeTimeLabel(session.updatedAt, timezone),
        state: 'ready-to-share',
        statusLabel: 'Publication status unavailable',
        statusTone: 'neutral',
        actionLabel: 'Review assignment',
        destination: 'review',
        selected: false,
      });
    }
    items.sort(
      (left, right) =>
        Date.parse(timeByItemId.get(right.id)!) - Date.parse(timeByItemId.get(left.id)!),
    );
    return { lineages: buildRecentAssignmentLineages(items), sessionsById, ownerByItemId };
  }, [data, timezone]);

  const isTranscript = (item: RecentAssignmentItem) => {
    const session = sessionsById.get(item.id.replace(/^session:/, ''));
    return (
      item.kind === 'session' &&
      session?.homeworkIntent === 'none' &&
      Boolean(session.transcriptCompletedAt)
    );
  };
  const visible = lineages.filter(({ latest, olderVersions }) =>
    [latest, ...olderVersions].some((item) => {
      const owner = ownerByItemId.get(item.id);
      return (
        (!studentId || owner === studentId) &&
        (!query.trim() ||
          `${item.learnerName} ${item.activityLabel} ${item.statusLabel}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())) &&
        (filter === 'all' ||
          (filter === 'transcript' && isTranscript(item)) ||
          (filter === 'published' && item.kind === 'job' && item.state === 'published') ||
          (filter === 'unfinished' && item.state !== 'published' && !isTranscript(item)))
      );
    }),
  );

  const renderRow = (item: RecentAssignmentItem) => (
    <Link
      className="studio-assignment-list__row"
      to={
        item.kind === 'session'
          ? `/?sessionId=${encodeURIComponent(item.id.slice('session:'.length))}`
          : `/?jobId=${encodeURIComponent(item.id)}`
      }
    >
      <FileText size={21} aria-hidden="true" />
      <span className="studio-assignment-list__identity">
        <strong>{item.learnerName}</strong>
        <span>{item.activityLabel}</span>
        <span className="studio-assignment-list__time">{item.timeLabel}</span>
      </span>
      <span className="studio-assignment-list__outcome">
        <span
          className={`studio-assignment-list__status studio-assignment-list__status--${item.statusTone}`}
        >
          {item.statusLabel}
        </span>
        <span>
          {item.actionLabel} <ArrowRight size={15} aria-hidden="true" />
        </span>
      </span>
    </Link>
  );
  const hasMore = data
    ? data.activeOffset < data.activeTotal ||
      data.historyOffset < data.historyTotal ||
      data.jobsOffset < data.jobsTotal
    : false;

  return (
    <section className="studio-assignment-list" aria-label="Assignments">
      <header className="studio-assignment-list__heading">
        <h1>Assignments</h1>
        <Link className="product-button product-button--primary" to="/assignments/new">
          <Plus size={18} aria-hidden="true" />
          Start assignment
        </Link>
      </header>
      <div className="studio-assignment-list__filters">
        <label className="studio-assignment-list__search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="Find assignments"
            placeholder="Find assignments"
            value={query}
            onChange={(event) => updateFilter('q', event.target.value)}
          />
        </label>
        <label>
          Show
          <select value={filter} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="all">All work</option>
            <option value="unfinished">In progress</option>
            <option value="published">Published</option>
            <option value="transcript">Transcript-only</option>
          </select>
        </label>
        <label>
          Student
          <select
            value={studentId}
            onChange={(event) => updateFilter('student', event.target.value)}
          >
            <option value="">All students</option>
            {data?.students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading && !data ? <LoadingPlaceholder label="Loading assignments" /> : null}
      {error ? (
        <div role="alert">
          <p>Assignments unavailable.</p>
          <ProductButton variant="secondary" onClick={() => void load()}>
            Retry
          </ProductButton>
        </div>
      ) : null}
      {data ? (
        <>
          {hasMore ? (
            <p className="studio-assignment-list__coverage">Filters apply to loaded work.</p>
          ) : null}
          {!visible.length && !loading ? (
            <p className="studio-assignment-list__empty">
              {lineages.length
                ? 'No loaded assignments match these filters.'
                : 'No assignments found.'}
            </p>
          ) : null}
          <ul className="studio-assignment-list__rows">
            {visible.map((lineage) => (
              <li key={lineage.id}>
                {renderRow(lineage.latest)}
                {lineage.olderVersions.length ? (
                  <details className="studio-assignment-list__versions">
                    <summary>
                      {lineage.olderVersions.length} earlier{' '}
                      {lineage.olderVersions.length === 1 ? 'version' : 'versions'}
                    </summary>
                    <ul>
                      {lineage.olderVersions.map((version) => (
                        <li key={version.id}>{renderRow(version)}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
          {moreError ? (
            <p role="alert">Older assignments unavailable. Your loaded work is preserved.</p>
          ) : null}
          {hasMore ? (
            <ProductButton
              variant="secondary"
              disabled={loading}
              busy={loadingMore}
              onClick={() => void loadMore()}
            >
              {moreError ? 'Retry older assignments' : 'Load older assignments'}
            </ProductButton>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

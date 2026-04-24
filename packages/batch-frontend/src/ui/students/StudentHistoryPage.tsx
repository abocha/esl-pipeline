import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getStudentTimeline,
  listStudentHomeworkMemoryEntries,
  listStudentLessonMemoryEntries,
  type HomeworkMemoryRecord,
  type LessonMemoryRecord,
  type StudentTimelineItem,
} from '../../utils/api';
import { useStudentAreaContext } from './StudentAreaContext';

type HistoryFilter = 'all' | 'lessons' | 'homework' | 'profile' | 'materials' | 'operations';
type HistoryEventDensity = 'rich' | 'compact';
type HistoryEventTone = 'blue' | 'green' | 'amber' | 'rose' | 'quiet';

interface HistoryEvent {
  id: string;
  category: Exclude<HistoryFilter, 'all'>;
  createdAt: string;
  title: string;
  subtitle: string;
  summary?: string;
  density: HistoryEventDensity;
  tone: HistoryEventTone;
  tags: string[];
  meta: string[];
  detailRows: { label: string; value: string }[];
  href?: string;
}

interface HistoryData {
  timeline: StudentTimelineItem[];
  lessons: LessonMemoryRecord[];
  homework: HomeworkMemoryRecord[];
}

const EMPTY_HISTORY_DATA: HistoryData = {
  timeline: [],
  lessons: [],
  homework: [],
};

const FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'lessons', label: 'Lessons' },
  { key: 'homework', label: 'Homework' },
  { key: 'profile', label: 'Profile' },
  { key: 'materials', label: 'Materials' },
  { key: 'operations', label: 'Operations' },
];

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unknown';
  return DATE_FORMATTER.format(date);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return TIME_FORMATTER.format(date);
}

function getDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const candidate = trimmed.slice(0, maxLength - 3);
  const lastSpaceIndex = candidate.lastIndexOf(' ');
  const truncated =
    lastSpaceIndex > Math.floor(maxLength * 0.55) ? candidate.slice(0, lastSpaceIndex) : candidate;
  return `${truncated.trimEnd()}...`;
}

function compactList(values: readonly (string | null | undefined)[], limit: number): string[] {
  return values
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
    .slice(0, limit);
}

function detailValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function detailsRecord(item: StudentTimelineItem): Record<string, unknown> {
  return item.details ?? {};
}

function makeEventId(prefix: string, id: string, createdAt: string): string {
  return `${prefix}:${id}:${createdAt}`;
}

function lessonToEvent(record: LessonMemoryRecord): HistoryEvent {
  const title = record.topicsDiscussed[0]?.topic?.trim() || 'Lesson memory created';
  const tags = [
    ...compactList(record.topicsDiscussed.map((topic) => topic.topic), 2),
    ...compactList(record.grammarReviewed.map((item) => item.name), 1),
    ...compactList(record.vocabularyFocus.map((item) => item.text), 1),
  ];
  const followUp = record.followUpRecommendations[0];

  return {
    id: makeEventId('lesson', record.id, record.createdAt),
    category: 'lessons',
    createdAt: record.createdAt,
    title: 'Lesson memory created',
    subtitle: title,
    summary: record.lessonSummary ? truncateText(record.lessonSummary, 210) : undefined,
    density: 'rich',
    tone: 'blue',
    tags,
    meta: ['duration pending · format pending'],
    detailRows: [
      { label: 'Lesson memory ID', value: record.id },
      { label: 'Recording ID', value: record.recordingId },
      { label: 'Transcript ID', value: record.transcriptId },
      { label: 'Status', value: record.status },
      ...(followUp ? [{ label: 'Follow-up', value: `${followUp.label}: ${followUp.note}` }] : []),
    ],
  };
}

function homeworkToEvent(record: HomeworkMemoryRecord): HistoryEvent {
  const firstTarget =
    record.reviewTargets[0]?.label ??
    record.grammarTargets[0]?.name ??
    record.vocabularyTargets[0]?.text ??
    record.teacherFollowUpCues[0]?.cueType ??
    null;
  const publishUrl = record.publishTargets.find((target) => target.url)?.url ?? undefined;

  return {
    id: makeEventId('homework', record.id, record.publishedAt),
    category: 'homework',
    createdAt: record.publishedAt,
    title: 'Homework assigned',
    subtitle: record.topic?.trim() || 'Published assignment',
    summary: record.homeworkSummary ? truncateText(record.homeworkSummary, 210) : undefined,
    density: 'rich',
    tone: 'green',
    tags: compactList(
      [
        firstTarget,
        record.inputType ? `${record.inputType} input` : null,
        record.studyTextType ? `${record.studyTextType} study text` : null,
      ].filter((value): value is string => Boolean(value)),
      3,
    ),
    meta: [`${record.taskList.length} ${record.taskList.length === 1 ? 'task' : 'tasks'}`],
    href: publishUrl,
    detailRows: [
      { label: 'Homework memory ID', value: record.id },
      { label: 'Job ID', value: record.jobId },
      { label: 'Lineage', value: record.assignmentLineageKey },
      { label: 'Status', value: record.status },
      ...(record.teacherFollowUpCues[0]
        ? [{ label: 'Teacher follow-up', value: record.teacherFollowUpCues[0].note }]
        : []),
    ],
  };
}

function getTimelineCategory(item: StudentTimelineItem): Exclude<HistoryFilter, 'all'> | null {
  if (item.type.startsWith('profile_revision') || item.type === 'student_profile_binding_changed') {
    return 'profile';
  }
  if (
    item.type.startsWith('template_revision') ||
    item.type === 'prompt_package_created' ||
    item.type === 'draft_saved' ||
    item.type === 'job_completed' ||
    item.type === 'job_awaiting_approval'
  ) {
    return 'materials';
  }
  if (item.type.startsWith('job_action')) {
    return 'operations';
  }
  if (item.type === 'recording_ingested' || item.type === 'transcript_ready') {
    return 'lessons';
  }
  return null;
}

function getTimelineLabel(item: StudentTimelineItem): string {
  switch (item.type) {
    case 'profile_revision_activated':
      return 'Profile revision activated';
    case 'profile_revision_restored':
      return 'Profile restored';
    case 'profile_revision_saved':
      return 'Profile updated';
    case 'student_profile_binding_changed':
      return 'Profile connection changed';
    case 'template_revision_activated':
      return 'Template activated';
    case 'template_revision_restored':
      return 'Template restored';
    case 'template_revision_saved':
      return 'Template updated';
    case 'prompt_package_created':
      return 'Material generated';
    case 'draft_saved':
      return 'Draft generated';
    case 'job_awaiting_approval':
      return 'Assignment awaiting review';
    case 'job_completed':
      return item.status === 'failed' ? 'Assignment generation failed' : 'Assignment published';
    case 'job_action_rerun':
      return 'Rerun requested';
    case 'job_action_cancel':
      return 'Cancellation requested';
    case 'job_action_edit_metadata':
      return 'Metadata edited';
    case 'recording_ingested':
      return 'Recording added';
    case 'transcript_ready':
      return 'Transcript ready';
    default:
      return 'History event';
  }
}

function getTimelineTone(item: StudentTimelineItem): HistoryEventTone {
  if (item.status === 'failed') return 'rose';
  if (item.type.startsWith('job_action')) return 'amber';
  if (item.type.startsWith('profile_revision') || item.type === 'student_profile_binding_changed') {
    return 'green';
  }
  if (item.type.startsWith('template_revision') || item.type === 'prompt_package_created') {
    return 'quiet';
  }
  return 'quiet';
}

function timelineToEvent(item: StudentTimelineItem): HistoryEvent | null {
  const category = getTimelineCategory(item);
  if (!category) return null;
  const details = detailsRecord(item);
  const versionLabel = detailValue(details.versionLabel);
  const message = detailValue(details.message);
  const htmlUrl = detailValue(details.htmlUrl);
  const source = detailValue(details.source);

  return {
    id: makeEventId(item.type, item.jobId ?? item.draftId ?? item.promptPackageId ?? item.recordingId ?? item.displayName, item.createdAt),
    category,
    createdAt: item.createdAt,
    title: getTimelineLabel(item),
    subtitle: versionLabel ?? message ?? item.displayName,
    summary: message ?? undefined,
    density: 'compact',
    tone: getTimelineTone(item),
    tags: compactList([versionLabel], 1),
    meta: [],
    href: htmlUrl ?? undefined,
    detailRows: [
      { label: 'Source event', value: item.type },
      { label: 'Status', value: item.status },
      ...(source ? [{ label: 'Source', value: source }] : []),
      ...(item.recordingId ? [{ label: 'Recording ID', value: item.recordingId }] : []),
      ...(item.transcriptId ? [{ label: 'Transcript ID', value: item.transcriptId }] : []),
      ...(item.promptPackageId ? [{ label: 'Prompt package ID', value: item.promptPackageId }] : []),
      ...(item.draftId ? [{ label: 'Draft ID', value: item.draftId }] : []),
      ...(item.jobId ? [{ label: 'Job ID', value: item.jobId }] : []),
      ...(detailValue(details.profileRevisionId)
        ? [{ label: 'Profile revision ID', value: detailValue(details.profileRevisionId) ?? '' }]
        : []),
      ...(detailValue(details.templateRevisionId)
        ? [{ label: 'Template revision ID', value: detailValue(details.templateRevisionId) ?? '' }]
        : []),
    ],
  };
}

function buildHistoryEvents(data: HistoryData): HistoryEvent[] {
  const coveredRecordingIds = new Set(data.lessons.map((lesson) => lesson.recordingId));
  const coveredTranscriptIds = new Set(data.lessons.map((lesson) => lesson.transcriptId));
  const coveredHomeworkJobIds = new Set(data.homework.map((homework) => homework.jobId));
  const activeProfileRevisionIds = new Set(
    data.timeline
      .filter((item) => item.type === 'profile_revision_activated')
      .map((item) => detailValue(detailsRecord(item).profileRevisionId))
      .filter((value): value is string => Boolean(value)),
  );

  const timelineEvents = data.timeline
    .filter((item) => {
      if (
        (item.type === 'recording_ingested' && item.recordingId && coveredRecordingIds.has(item.recordingId)) ||
        (item.type === 'transcript_ready' && item.transcriptId && coveredTranscriptIds.has(item.transcriptId))
      ) {
        return false;
      }
      if (item.type === 'job_completed' && item.jobId && coveredHomeworkJobIds.has(item.jobId)) {
        return item.status === 'failed';
      }
      if (
        item.type === 'profile_revision_saved' &&
        activeProfileRevisionIds.has(detailValue(detailsRecord(item).profileRevisionId) ?? '')
      ) {
        return false;
      }
      return true;
    })
    .map(timelineToEvent)
    .filter((event): event is HistoryEvent => Boolean(event));

  return [
    ...data.lessons.map(lessonToEvent),
    ...data.homework.map(homeworkToEvent),
    ...timelineEvents,
  ].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return left.id.localeCompare(right.id);
    if (Number.isNaN(leftTime)) return 1;
    if (Number.isNaN(rightTime)) return -1;
    return rightTime - leftTime;
  });
}

function groupEvents(events: readonly HistoryEvent[]): { dateKey: string; label: string; events: HistoryEvent[] }[] {
  const groups = new Map<string, HistoryEvent[]>();
  for (const event of events) {
    const key = getDateKey(event.createdAt);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  return [...groups.entries()].map(([dateKey, items]) => ({
    dateKey,
    label: items[0] ? formatDate(items[0].createdAt) : 'Date unknown',
    events: items,
  }));
}

function StudentHistoryPendingCanvas({
  errorMessage,
}: {
  errorMessage: string | null;
}): React.JSX.Element {
  return (
    <section className="student-history-page" aria-busy="true">
      <div className="student-history-frame" data-testid="student-history-pending-canvas">
        <span className="student-history-sr-only" role="status">
          Loading student history
        </span>
        {errorMessage ? (
          <p className="student-history-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="student-history-pending-hero" aria-hidden="true">
          <span className="student-history-skeleton skeleton-portrait" />
          <span>
            <span className="student-history-skeleton skeleton-title" />
            <span className="student-history-skeleton skeleton-copy skeleton-copy-wide" />
            <span className="student-history-skeleton skeleton-copy" />
          </span>
          <span className="student-history-skeleton skeleton-about" />
        </div>
        <div className="student-history-pending-filters" aria-hidden="true">
          {FILTERS.map((filter) => (
            <span key={filter.key} className="student-history-skeleton skeleton-filter" />
          ))}
        </div>
        <div className="student-history-pending-list" aria-hidden="true">
          {[1, 2, 3].map((item) => (
            <span key={item} className="student-history-skeleton skeleton-card" />
          ))}
        </div>
      </div>
      <style>{studentHistoryStyles}</style>
    </section>
  );
}

function HistoryEventCard({ event }: { event: HistoryEvent }): React.JSX.Element {
  return (
    <article className={`student-history-event event-${event.tone} event-${event.density}`}>
      <div className="student-history-event-marker" aria-hidden="true">
        {event.category.slice(0, 2).toUpperCase()}
      </div>
      <div className="student-history-event-card">
        <header>
          <div>
            <p className="student-history-event-title">{event.title}</p>
            <h3>{event.subtitle}</h3>
          </div>
          <div className="student-history-event-meta">
            <time dateTime={event.createdAt}>{formatTime(event.createdAt)}</time>
            {event.meta.map((meta) => (
              <span key={meta}>{meta}</span>
            ))}
          </div>
        </header>
        {event.summary ? <p className="student-history-event-summary">{event.summary}</p> : null}
        {event.tags.length > 0 ? (
          <div className="student-history-tags">
            {event.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
        <footer>
          {event.href ? (
            <a href={event.href} target="_blank" rel="noreferrer">
              Open artifact
            </a>
          ) : null}
          {event.detailRows.length > 0 ? (
            <details>
              <summary>Provenance</summary>
              <dl>
                {event.detailRows.map((row) => (
                  <React.Fragment key={`${row.label}-${row.value}`}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </details>
          ) : null}
        </footer>
      </div>
    </article>
  );
}

export const StudentHistoryPage: React.FC = () => {
  const { studentId, studentLoading, studentError } = useStudentAreaContext();
  const [historyData, setHistoryData] = useState<HistoryData>(EMPTY_HISTORY_DATA);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadedStudentId, setLoadedStudentId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<HistoryFilter>('all');
  const latestHistoryRequestRef = useRef(0);

  useEffect(() => {
    const requestId = latestHistoryRequestRef.current + 1;
    latestHistoryRequestRef.current = requestId;

    if (studentLoading) {
      setHistoryLoading(true);
      setHistoryError(null);
      return undefined;
    }

    if (!studentId) {
      setHistoryData(EMPTY_HISTORY_DATA);
      setHistoryLoading(false);
      setHistoryError('Student ID is required.');
      setLoadedStudentId(null);
      return undefined;
    }

    setHistoryLoading(true);
    setHistoryError(null);

    const loadHistory = async () => {
      const [timelineResult, lessonResult, homeworkResult] = await Promise.allSettled([
        getStudentTimeline(studentId, { limit: 100, offset: 0, order: 'desc' }),
        listStudentLessonMemoryEntries(studentId, {
          status: 'ready',
          limit: 60,
          offset: 0,
          order: 'desc',
        }),
        listStudentHomeworkMemoryEntries(studentId, {
          status: 'ready',
          limit: 60,
          offset: 0,
          order: 'desc',
        }),
      ]);

      if (latestHistoryRequestRef.current !== requestId) {
        return;
      }

      setHistoryData({
        timeline: timelineResult.status === 'fulfilled' ? timelineResult.value.items : [],
        lessons: lessonResult.status === 'fulfilled' ? lessonResult.value.items : [],
        homework: homeworkResult.status === 'fulfilled' ? homeworkResult.value.items : [],
      });
      setLoadedStudentId(studentId);
      setHistoryError(
        [timelineResult, lessonResult, homeworkResult].some((result) => result.status === 'rejected')
          ? 'Some history context could not be loaded.'
          : null,
      );
      setHistoryLoading(false);
    };

    void loadHistory();

    return () => {
      latestHistoryRequestRef.current += 1;
    };
  }, [studentId, studentLoading]);

  const historyReady = loadedStudentId === studentId && !historyLoading;
  const events = useMemo(() => buildHistoryEvents(historyData), [historyData]);
  const filteredEvents = activeFilter === 'all' ? events : events.filter((event) => event.category === activeFilter);
  const groupedEvents = groupEvents(filteredEvents);

  if (!historyReady) {
    return <StudentHistoryPendingCanvas errorMessage={studentError} />;
  }

  return (
    <section className="student-history-page" aria-busy={studentLoading || !historyReady}>
      <div className="student-history-frame">
        <article className="student-history-about">
          <p className="student-history-section-label">About this history</p>
          <p>
            This timeline includes lessons, homework, materials, profile updates, and important
            operations.
          </p>
          <Link to={`/students/${encodeURIComponent(studentId)}/overview`}>How history works</Link>
        </article>

        {studentError || historyError ? (
          <p className="student-history-error" role="alert">
            {studentError ?? historyError}
          </p>
        ) : null}

        <div className="student-history-filters" aria-label="History filters">
          <span>Show</span>
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={activeFilter === filter.key ? 'active' : ''}
              aria-pressed={activeFilter === filter.key}
              onClick={() => setActiveFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {filteredEvents.length > 0 ? (
          <div className="student-history-timeline">
            {groupedEvents.map((group) => (
              <section key={group.dateKey} className="student-history-date-group">
                <h3>{group.label}</h3>
                <div className="student-history-date-events">
                  {group.events.map((event) => (
                    <HistoryEventCard key={event.id} event={event} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <article className="student-history-empty">
            <h3>History will collect here</h3>
            <p>
              Lesson, homework, profile, material, and operations events will appear as this student
              works through the new flow.
            </p>
          </article>
        )}

        <p className="student-history-note">Small, regular steps create real progress.</p>
      </div>
      <style>{studentHistoryStyles}</style>
    </section>
  );
};

const studentHistoryStyles = `
  .student-history-page {
    --history-paper: #fbf7ee;
    --history-paper-deep: #f4eadb;
    --history-ink: #151412;
    --history-muted: #6f665a;
    --history-blue: #143f73;
    --history-blue-soft: #e8eef7;
    --history-sage: #315c3a;
    --history-sage-soft: #edf4e7;
    --history-amber: #91620c;
    --history-amber-soft: #fff5dd;
    --history-rose: #8f3f32;
    --history-rose-soft: #fae8e2;
    --history-line: rgba(42, 36, 26, 0.13);
    color: var(--history-ink);
  }

  .student-history-frame {
    position: relative;
    display: grid;
    gap: 1.6rem;
    padding: clamp(1.25rem, 3vw, 2.4rem);
    overflow: hidden;
    border: 1px solid var(--history-line);
    border-radius: 30px;
    background:
      radial-gradient(circle at 10% 0%, rgba(20, 63, 115, 0.07), transparent 34%),
      radial-gradient(circle at 88% 28%, rgba(49, 92, 58, 0.08), transparent 30%),
      linear-gradient(135deg, rgba(255, 252, 245, 0.98), rgba(247, 239, 226, 0.92));
    box-shadow: 0 18px 48px rgba(42, 36, 26, 0.08);
  }

  .student-history-frame::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.32;
    background-image:
      linear-gradient(rgba(42, 36, 26, 0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(42, 36, 26, 0.025) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: linear-gradient(180deg, black, transparent 88%);
  }

  .student-history-frame > * {
    position: relative;
  }

  .student-history-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .student-history-back,
  .student-history-about a,
  .student-history-event-card a {
    color: var(--history-blue);
    font-weight: 700;
    text-decoration: none;
  }

  .student-history-back:hover,
  .student-history-about a:hover,
  .student-history-event-card a:hover {
    text-decoration: underline;
  }

  .student-history-hero,
  .student-history-pending-hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) minmax(16rem, 0.48fr);
    align-items: center;
    gap: clamp(1.5rem, 4vw, 3rem);
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--history-line);
  }

  .student-history-portrait {
    display: grid;
    place-items: center;
    width: clamp(8rem, 18vw, 12rem);
    aspect-ratio: 1;
    border: 1px solid rgba(42, 36, 26, 0.12);
    border-radius: 999px;
    background:
      radial-gradient(circle at 32% 25%, rgba(255, 255, 255, 0.72), transparent 30%),
      linear-gradient(135deg, rgba(20, 63, 115, 0.13), rgba(49, 92, 58, 0.16));
    color: var(--history-blue);
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(3rem, 8vw, 5rem);
  }

  .student-history-identity p,
  .student-history-section-label {
    margin: 0;
    color: var(--history-blue);
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  .student-history-identity h2 {
    margin: 0.15rem 0 0.7rem;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(3rem, 7vw, 5.8rem);
    font-weight: 500;
    letter-spacing: -0.055em;
    line-height: 0.95;
  }

  .student-history-identity span {
    display: block;
    max-width: 32rem;
    color: var(--history-ink);
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(1.1rem, 2vw, 1.4rem);
    line-height: 1.6;
  }

  .student-history-about {
    display: grid;
    gap: 0.75rem;
    padding: 1.25rem;
    border: 1px solid var(--history-line);
    border-radius: 20px;
    background: rgba(255, 252, 245, 0.58);
  }

  .student-history-about p {
    margin: 0;
    color: var(--history-muted);
    line-height: 1.6;
  }

  .student-history-error {
    margin: 0;
    padding: 0.9rem 1rem;
    border: 1px solid rgba(145, 98, 12, 0.24);
    border-radius: 16px;
    background: var(--history-amber-soft);
    color: var(--history-amber);
    font-weight: 700;
  }

  .student-history-filters,
  .student-history-pending-filters {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .student-history-filters span {
    color: var(--history-muted);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .student-history-filters button {
    padding: 0.65rem 1rem;
    border: 1px solid var(--history-line);
    border-radius: 12px;
    background: rgba(255, 252, 245, 0.62);
    color: var(--history-ink);
    cursor: pointer;
    font: inherit;
    font-weight: 700;
  }

  .student-history-filters button.active {
    background: var(--history-blue-soft);
    border-color: rgba(20, 63, 115, 0.2);
    color: var(--history-blue);
  }

  .student-history-timeline {
    display: grid;
    gap: 1.7rem;
  }

  .student-history-date-group {
    display: grid;
    grid-template-columns: minmax(7rem, 10rem) minmax(0, 1fr);
    gap: clamp(1rem, 3vw, 2rem);
  }

  .student-history-date-group > h3 {
    margin: 0.3rem 0 0;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.25rem;
    font-weight: 500;
  }

  .student-history-date-events {
    position: relative;
    display: grid;
    gap: 0.85rem;
  }

  .student-history-date-events::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 1.45rem;
    width: 1px;
    background: var(--history-line);
  }

  .student-history-event {
    position: relative;
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }

  .student-history-event-marker {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 2.9rem;
    height: 2.9rem;
    border: 1px solid var(--history-line);
    border-radius: 999px;
    background: var(--history-paper);
    color: var(--history-blue);
    font-size: 0.68rem;
    font-weight: 900;
    letter-spacing: 0.06em;
  }

  .event-green .student-history-event-marker {
    background: var(--history-sage-soft);
    color: var(--history-sage);
  }

  .event-amber .student-history-event-marker {
    background: var(--history-amber-soft);
    color: var(--history-amber);
  }

  .event-rose .student-history-event-marker {
    background: var(--history-rose-soft);
    color: var(--history-rose);
  }

  .student-history-event-card {
    display: grid;
    gap: 0.7rem;
    padding: 1.05rem 1.25rem;
    border: 1px solid var(--history-line);
    border-radius: 18px;
    background: rgba(255, 252, 245, 0.64);
    box-shadow: 0 12px 28px rgba(42, 36, 26, 0.045);
  }

  .event-rich .student-history-event-card {
    padding: 1.25rem 1.45rem;
  }

  .student-history-event-card header,
  .student-history-event-card footer {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 1rem;
  }

  .student-history-event-title {
    margin: 0 0 0.2rem;
    color: var(--history-muted);
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .student-history-event-card h3 {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(1.15rem, 2vw, 1.55rem);
    font-weight: 500;
    line-height: 1.2;
  }

  .student-history-event-summary {
    margin: 0;
    color: var(--history-ink);
    line-height: 1.6;
  }

  .student-history-event-meta {
    display: grid;
    justify-items: end;
    gap: 0.35rem;
    min-width: max-content;
    color: var(--history-muted);
    font-weight: 700;
  }

  .student-history-event-meta time {
    color: var(--history-ink);
    font-variant-numeric: tabular-nums;
  }

  .student-history-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .student-history-tags span {
    padding: 0.35rem 0.65rem;
    border: 1px solid rgba(49, 92, 58, 0.14);
    border-radius: 8px;
    background: rgba(237, 244, 231, 0.76);
    color: var(--history-sage);
    font-size: 0.82rem;
  }

  .student-history-event-card details {
    color: var(--history-muted);
  }

  .student-history-event-card summary {
    cursor: pointer;
    color: var(--history-blue);
    font-weight: 700;
  }

  .student-history-event-card dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.35rem 0.8rem;
    margin: 0.75rem 0 0;
    font-size: 0.82rem;
  }

  .student-history-event-card dt {
    color: var(--history-muted);
    font-weight: 800;
  }

  .student-history-event-card dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .student-history-empty {
    padding: clamp(2rem, 6vw, 4rem);
    border: 1px dashed var(--history-line);
    border-radius: 22px;
    background: rgba(255, 252, 245, 0.48);
    text-align: center;
  }

  .student-history-empty h3 {
    margin: 0 0 0.5rem;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: clamp(1.5rem, 3vw, 2.1rem);
    font-weight: 500;
  }

  .student-history-empty p {
    max-width: 34rem;
    margin: 0 auto;
    color: var(--history-muted);
    line-height: 1.6;
  }

  .student-history-note {
    justify-self: center;
    margin: 0;
    color: var(--history-blue);
    font-family: Georgia, 'Times New Roman', serif;
    font-style: italic;
    letter-spacing: 0.08em;
  }

  .student-history-skeleton {
    display: block;
    position: relative;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(42, 36, 26, 0.1);
  }

  .student-history-skeleton::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, rgba(255, 252, 245, 0.55), transparent);
    animation: history-skeleton-breathe 1.8s ease-in-out infinite;
  }

  .skeleton-portrait {
    width: clamp(8rem, 18vw, 12rem);
    aspect-ratio: 1;
  }

  .skeleton-title {
    width: min(30rem, 70vw);
    height: 4rem;
    margin-bottom: 1rem;
  }

  .skeleton-copy {
    width: 16rem;
    height: 0.9rem;
    margin-top: 0.55rem;
  }

  .skeleton-copy-wide {
    width: min(26rem, 62vw);
  }

  .skeleton-about {
    width: 100%;
    min-height: 9rem;
    border-radius: 20px;
  }

  .skeleton-filter {
    width: 6rem;
    height: 2.6rem;
    border-radius: 12px;
  }

  .student-history-pending-list {
    display: grid;
    gap: 0.8rem;
    padding-left: clamp(4rem, 16vw, 12rem);
  }

  .skeleton-card {
    height: 6.5rem;
    border-radius: 18px;
  }

  @keyframes history-skeleton-breathe {
    100% {
      transform: translateX(100%);
    }
  }

  @media (max-width: 900px) {
    .student-history-hero,
    .student-history-pending-hero,
    .student-history-date-group {
      grid-template-columns: 1fr;
    }

    .student-history-portrait {
      width: 8rem;
    }

    .student-history-event-card header,
    .student-history-event-card footer {
      display: grid;
    }

    .student-history-event-meta {
      justify-items: start;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .student-history-skeleton::after {
      animation: none;
    }
  }
`;

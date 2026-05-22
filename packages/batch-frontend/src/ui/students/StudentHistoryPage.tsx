import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  getStudentHistorySurface,
  getStudentTimeline,
  type HomeworkMemoryRecord,
  type LessonMemoryRecord,
  listStudentHomeworkMemoryEntries,
  listStudentLessonMemoryEntries,
  listStudentProfileCandidates,
  type StudentProfileCandidate,
  type StudentTimelineItem,
} from '../../utils/api';
import { useStudentAreaContext } from './StudentAreaContext';
import './StudentHistoryPage.css';

type HistoryFilter =
  | 'all'
  | 'lessons'
  | 'homework'
  | 'profile'
  | 'materials'
  | 'billing'
  | 'business'
  | 'operations';
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
  candidates: StudentProfileCandidate[];
}

const EMPTY_HISTORY_DATA: HistoryData = {
  timeline: [],
  lessons: [],
  homework: [],
  candidates: [],
};

const FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'lessons', label: 'Lessons' },
  { key: 'homework', label: 'Homework' },
  { key: 'profile', label: 'Profile' },
  { key: 'materials', label: 'Materials' },
  { key: 'billing', label: 'Billing' },
  { key: 'business', label: 'Business' },
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

function detailScalarValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value.trim() : null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
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
    ...compactList(
      record.topicsDiscussed.map((topic) => topic.topic),
      2,
    ),
    ...compactList(
      record.grammarReviewed.map((item) => item.name),
      1,
    ),
    ...compactList(
      record.vocabularyFocus.map((item) => item.text),
      1,
    ),
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

function candidateToEvent(record: StudentProfileCandidate): HistoryEvent | null {
  const decision =
    typeof record.dedupDecision?.decision === 'string' ? record.dedupDecision.decision : null;
  const isDropped = decision === 'duplicate' || decision === 'stale';
  if (!isDropped && !record.sourceLessonTitle && !record.sourceLessonId) {
    return null;
  }
  const reason =
    typeof record.dedupDecision?.reason === 'string' ? record.dedupDecision.reason : null;
  return {
    id: makeEventId('profile-candidate', record.id, record.createdAt),
    category: 'profile',
    createdAt: record.createdAt,
    title: isDropped ? `Profile candidate dropped as ${decision}` : 'Profile candidate proposed',
    subtitle: record.sourceLessonTitle ?? record.proposedFact,
    summary: reason ?? truncateText(record.proposedFact, 210),
    density: 'compact',
    tone: isDropped ? 'amber' : 'green',
    tags: compactList([decision, record.reviewState, record.targetSection], 3),
    meta: [],
    detailRows: [
      { label: 'Candidate ID', value: record.id },
      { label: 'Candidate fact', value: record.proposedFact },
      ...(record.sourceLessonId
        ? [{ label: 'Source lesson ID', value: record.sourceLessonId }]
        : []),
      ...(record.sourceLessonStartedAt
        ? [{ label: 'Source lesson date', value: record.sourceLessonStartedAt }]
        : []),
      ...(record.sourceMemoryIds && record.sourceMemoryIds.length > 0
        ? [{ label: 'Source memory IDs', value: record.sourceMemoryIds.join(', ') }]
        : []),
      ...(decision ? [{ label: 'Dedup decision', value: decision }] : []),
      ...(reason ? [{ label: 'Dedup reason', value: reason }] : []),
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
  if (
    item.type === 'lesson_created' ||
    item.type === 'lesson_updated' ||
    item.type === 'lesson_completed' ||
    item.type === 'lesson_canceled' ||
    item.type === 'lesson_no_show' ||
    item.type === 'lesson_plan_updated' ||
    item.type === 'lesson_recurrence_updated'
  ) {
    return 'lessons';
  }
  if (item.type === 'credit_event_recorded' || item.type === 'payment_recorded') {
    return 'billing';
  }
  if (item.type === 'business_settings_updated') {
    return 'business';
  }
  if (item.type === 'reminder_hidden') {
    return 'operations';
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
    case 'lesson_created':
      return 'Lesson scheduled';
    case 'lesson_updated':
      return 'Lesson updated';
    case 'lesson_completed':
      return 'Lesson completed';
    case 'lesson_canceled':
      return 'Lesson canceled';
    case 'lesson_no_show':
      return 'Lesson marked no-show';
    case 'lesson_plan_updated':
      return 'Lesson plan updated';
    case 'lesson_recurrence_updated':
      return 'Lesson recurrence updated';
    case 'credit_event_recorded':
      return item.status === 'credit_added' ? 'Lesson credits added' : 'Credit ledger updated';
    case 'payment_recorded':
      return item.status === 'voided' ? 'Payment voided' : 'Payment received';
    case 'reminder_hidden':
      return 'Reminder hidden';
    case 'business_settings_updated':
      return 'Business settings updated';
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
  if (item.type === 'credit_event_recorded' || item.type === 'payment_recorded') return 'green';
  if (item.type === 'business_settings_updated' || item.type === 'reminder_hidden') return 'amber';
  if (item.type.startsWith('lesson_')) return 'blue';
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
  const lessonId = detailValue(details.lessonId);
  const startsAt = detailValue(details.startsAt);
  const durationMinutes = detailScalarValue(details.durationMinutes);
  const title = detailValue(details.title);
  const creditEventId = detailValue(details.creditEventId);
  const paymentId = detailValue(details.paymentId);
  const amountMinor = detailScalarValue(details.amountMinor);
  const currency = detailValue(details.currency);
  const quantityDelta = detailScalarValue(details.quantityDelta);
  const receivedAt = detailValue(details.receivedAt);
  const workspaceId = detailValue(details.workspaceId);

  return {
    id: makeEventId(
      item.type,
      item.jobId ?? item.draftId ?? item.promptPackageId ?? item.recordingId ?? item.displayName,
      item.createdAt,
    ),
    category,
    createdAt: item.createdAt,
    title: getTimelineLabel(item),
    subtitle: title ?? versionLabel ?? message ?? item.displayName,
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
      ...(item.promptPackageId
        ? [{ label: 'Prompt package ID', value: item.promptPackageId }]
        : []),
      ...(item.draftId ? [{ label: 'Draft ID', value: item.draftId }] : []),
      ...(item.jobId ? [{ label: 'Job ID', value: item.jobId }] : []),
      ...(lessonId ? [{ label: 'Lesson ID', value: lessonId }] : []),
      ...(startsAt ? [{ label: 'Lesson time', value: startsAt }] : []),
      ...(durationMinutes ? [{ label: 'Duration minutes', value: durationMinutes }] : []),
      ...(creditEventId ? [{ label: 'Credit event ID', value: creditEventId }] : []),
      ...(quantityDelta ? [{ label: 'Credit delta', value: quantityDelta }] : []),
      ...(paymentId ? [{ label: 'Payment ID', value: paymentId }] : []),
      ...(amountMinor && currency
        ? [{ label: 'Amount', value: `${currency} ${(Number(amountMinor) / 100).toFixed(2)}` }]
        : []),
      ...(receivedAt ? [{ label: 'Received at', value: receivedAt }] : []),
      ...(workspaceId ? [{ label: 'Workspace ID', value: workspaceId }] : []),
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
        (item.type === 'recording_ingested' &&
          item.recordingId &&
          coveredRecordingIds.has(item.recordingId)) ||
        (item.type === 'transcript_ready' &&
          item.transcriptId &&
          coveredTranscriptIds.has(item.transcriptId))
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
    ...data.candidates
      .map(candidateToEvent)
      .filter((event): event is HistoryEvent => Boolean(event)),
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

function groupEvents(
  events: readonly HistoryEvent[],
): { dateKey: string; label: string; events: HistoryEvent[] }[] {
  const groups = new Map<string, HistoryEvent[]>();
  for (const event of events) {
    const key = getDateKey(event.createdAt);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      groups.set(key, [event]);
    }
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
    <section className="student-history-page student-area-theme" aria-busy="true">
      <div
        className="student-area-frame student-history-frame"
        data-testid="student-history-pending-canvas"
      >
        <span className="student-history-sr-only" role="status">
          Loading student history
        </span>
        {errorMessage ? (
          <p className="student-history-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="student-history-pending-about" aria-hidden="true">
          <span className="student-history-skeleton skeleton-kicker" />
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
      try {
        const [surface, candidates] = await Promise.all([
          getStudentHistorySurface(studentId),
          listStudentProfileCandidates(studentId, { limit: 100, offset: 0, order: 'desc' }),
        ]);

        if (latestHistoryRequestRef.current !== requestId) {
          return;
        }

        setHistoryData({
          timeline: surface.timeline.items,
          lessons: surface.lessonMemory.items,
          homework: surface.homeworkMemory.items,
          candidates: candidates.items,
        });
        setLoadedStudentId(studentId);
        setHistoryError(null);
      } catch (error: unknown) {
        if (latestHistoryRequestRef.current !== requestId) {
          return;
        }
        const [timelineResult, lessonResult, homeworkResult, candidatesResult] =
          await Promise.allSettled([
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
            listStudentProfileCandidates(studentId, { limit: 100, offset: 0, order: 'desc' }),
          ]);
        if (latestHistoryRequestRef.current !== requestId) {
          return;
        }
        setHistoryData({
          timeline: timelineResult.status === 'fulfilled' ? timelineResult.value.items : [],
          lessons: lessonResult.status === 'fulfilled' ? lessonResult.value.items : [],
          homework: homeworkResult.status === 'fulfilled' ? homeworkResult.value.items : [],
          candidates: candidatesResult.status === 'fulfilled' ? candidatesResult.value.items : [],
        });
        setLoadedStudentId(studentId);
        setHistoryError(
          [timelineResult, lessonResult, homeworkResult, candidatesResult].some(
            (result) => result.status === 'rejected',
          )
            ? 'Some history context could not be loaded.'
            : error instanceof Error
              ? error.message
              : 'Some history context could not be loaded.',
        );
      } finally {
        if (latestHistoryRequestRef.current === requestId) {
          setHistoryLoading(false);
        }
      }
    };

    void loadHistory();

    return () => {
      latestHistoryRequestRef.current += 1;
    };
  }, [studentId, studentLoading]);

  const historyReady = loadedStudentId === studentId && !historyLoading;
  const events = useMemo(() => buildHistoryEvents(historyData), [historyData]);
  const filteredEvents =
    activeFilter === 'all' ? events : events.filter((event) => event.category === activeFilter);
  const groupedEvents = groupEvents(filteredEvents);

  if (!historyReady) {
    return <StudentHistoryPendingCanvas errorMessage={studentError} />;
  }

  return (
    <section
      className="student-history-page student-area-theme"
      aria-busy={studentLoading || !historyReady}
    >
      <div className="student-area-frame student-history-frame">
        <article className="student-area-panel student-history-about">
          <p className="student-history-section-label">About this history</p>
          <p>
            This timeline includes lessons, homework, materials, profile updates, billing, business,
            and important operations.
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
          <article className="student-area-empty-state student-history-empty">
            <h3>History will collect here</h3>
            <p>
              Lesson, homework, profile, material, billing, business, and operations events will
              appear as this student works through the new flow.
            </p>
          </article>
        )}

        <p className="student-history-note">Small, regular steps create real progress.</p>
      </div>
    </section>
  );
};

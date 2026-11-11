import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Menu,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Users,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useBlocker, useSearchParams } from 'react-router-dom';

import { ProductButton } from '../../ui/system/ProductButton';
import {
  displayDate,
  learners as fixtureLearners,
  initialLessons,
  type Learner,
  type Lesson,
  lessonNeedsHomeworkCompletion,
  type StudioView,
  studentViews,
  studioViews,
  today,
} from './fixtures';
import { SchedulingDrawer } from './SchedulingDrawer';
import { StudioDialog } from './StudioDialog';
import './CalmStudioV2.css';

import { AssignmentWorkspace } from './AssignmentWorkspace';
import {
  type AssignmentSlot,
  initialAssignments,
  newAssignment,
  type StudioAssignment,
  workbookError,
} from './assignment-model';
import { CalendarEventDialog } from './CalendarEventDialog';
import { LearningWorkspace } from './LearningWorkspace';
import {
  type LearningMemory,
  learningMemoryNotes,
  type ProfileData,
  profileFields,
  seedProfile,
} from './learning-data';
import {
  initialProfileChanges,
  initialProfiles,
  initialProfileVersions,
} from './profile-update-fixtures';
import { type ProfileChange, profileChanges, undoProfileChange } from './profile-updates';

type Dialog =
  | 'new-student'
  | 'schedule'
  | 'profile-changes'
  | 'versions'
  | 'payment'
  | 'provider'
  | 'associate'
  | 'new-assignment'
  | 'credits'
  | 'profile-update'
  | null;
type ContextState = 'ready' | 'empty' | 'unavailable';
const sectionLabels: Record<string, string> = {
  overview: 'Overview',
  learning: 'Learning',
  history: 'History',
  schedule: 'Schedule',
  billing: 'Billing',
};

export default function CalmStudioV2() {
  const [learners, setLearners] = useState<Learner[]>(() => [...fixtureLearners]);
  const [params, setParams] = useSearchParams();
  const [assignmentStore, setAssignmentStore] = useState(initialAssignments);
  const activeAssignmentId = params.get('assignment') ?? 'assignment-alex';
  const activeSlot = assignmentStore[activeAssignmentId] ?? assignmentStore['assignment-alex']!;
  const missingAssignment = params.has('assignment') && !assignmentStore[activeAssignmentId];
  const [newLessonId, setNewLessonId] = useState<string | null>(null);
  const [newAssignmentWillComplete, setNewAssignmentWillComplete] = useState(false);
  const [assignmentFilter, setAssignmentFilter] = useState('all');
  const requestedView = params.get('studioView');
  const view: StudioView = studioViews.includes(requestedView as StudioView)
    ? (requestedView as StudioView)
    : 'overview';
  const learner =
    view === 'editor'
      ? learners.find((item) => item.id === activeSlot.draft.learnerId)!
      : (learners.find((item) => item.id === params.get('learner')) ?? learners[0]!);
  const isStudent = studentViews.includes(view);
  const missingLearner =
    params.has('learner') && !learners.some((item) => item.id === params.get('learner'));
  const [rosterSearch, setRosterSearch] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [contextState, setContextState] = useState<ContextState>('ready');
  const [connected, setConnected] = useState(true);
  const [outcome, setOutcome] = useState<'success' | 'partial' | 'failure'>('success');
  const [saveFailure, setSaveFailure] = useState(false);
  const [lessons, setLessons] = useState(initialLessons);
  const [balances, setBalances] = useState<Record<string, number>>(
    Object.fromEntries(learners.map((item) => [item.id, item.balance])),
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedLesson, setSelectedLesson] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ProfileData>>(initialProfiles);
  const [profileDraft, setProfileDraft] = useState<ProfileData | null>(null);
  const [profileEditBase, setProfileEditBase] = useState<{
    learnerId: string;
    version: number;
    profile: ProfileData;
  } | null>(null);
  const [mergeChoices, setMergeChoices] = useState<
    Partial<Record<keyof ProfileData, 'mine' | 'latest'>>
  >({});
  const [profileVersions, setProfileVersions] =
    useState<Record<string, ProfileData[]>>(initialProfileVersions);
  const [profileChangeLog, setProfileChangeLog] = useState<ProfileChange[]>(initialProfileChanges);
  const learnerChanges = profileChangeLog.filter((change) => change.learnerId === learner.id);
  const [stage, setStage] = useState(4);
  const [notice, setNotice] = useState('');
  const [profileOrigins, setProfileOrigins] = useState<
    Record<string, 'tutor_only' | 'evidence_enriched'>
  >({ alex: 'evidence_enriched', maria: 'evidence_enriched', daniel: 'tutor_only' });
  const [memoryStates, setMemoryStates] = useState<Record<string, LearningMemory>>(() =>
    Object.fromEntries(
      ['assignment-alex', 'assignment-maria'].map((id) => {
        const source = assignmentStore[id]!.saved;
        return [
          source.learnerId,
          {
            status: 'ready',
            processingIssue:
              source.learnerId === 'maria'
                ? 'One later lesson memory failed. The last ready snapshot remains available.'
                : undefined,
            initial: false,
            sourceId: source.sourceId,
            assignmentId: source.id,
            latest: {
              summary: learningMemoryNotes[source.sourceId] ?? source.source,
              updatedAt: new Date(`${today}T09:30:00+07:00`).toISOString(),
              sourceId: source.sourceId,
              assignmentId: source.id,
            },
          },
        ];
      }),
    ),
  );
  const [memoryFailure, setMemoryFailure] = useState(false);
  const memoryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const processedSources = useRef(new Set<string>());
  const [error, setError] = useState('');
  const [pendingNavigation, setPendingNavigation] = useState<{
    view: StudioView;
    learnerId: string;
    assignmentId?: string;
    lessonId?: string;
  } | null>(null);
  const [payments, setPayments] = useState<
    { id: string; learnerId: string; date: string; amount: string }[]
  >([
    { id: 'payment-alex', learnerId: 'alex', date: today, amount: '120.00' },
    { id: 'payment-maria', learnerId: 'maria', date: today, amount: '80.00' },
  ]);
  const [activity, setActivity] = useState<
    { id: string; learnerId: string; label: string; detail: string }[]
  >([]);
  const mainHeading = useRef<HTMLHeadingElement>(null);
  const selectedLessonData = lessons.find((item) => item.id === selectedLesson);
  const newAssignmentLesson = lessons.find((item) => item.id === newLessonId);
  const newAssignmentCompletionPreview =
    newAssignmentWillComplete && lessonNeedsHomeworkCompletion(newAssignmentLesson);
  const profileData = profiles[learner.id] ?? seedProfile(learner);
  const profileVersion = profileVersions[learner.id]?.length ?? 1;
  const staleProfileDraft =
    profileDraft !== null &&
    profileEditBase !== null &&
    profileEditBase.learnerId === learner.id &&
    profileEditBase.version !== profileVersion;
  const latestLearning = useRef({
    assignmentStore,
    profiles,
    profileVersions,
    profileOrigins,
    profileChangeLog,
  });
  latestLearning.current = {
    assignmentStore,
    profiles,
    profileVersions,
    profileOrigins,
    profileChangeLog,
  };
  const startProcessing = useRef<
    (source: StudioAssignment, force?: boolean, fail?: boolean) => void
  >(() => {});
  function startMemoryRefresh(source: StudioAssignment, force = false, fail = memoryFailure) {
    const key = `${source.learnerId}:${source.sourceId}:${source.status === 'published' ? 'homework' : 'lesson'}`;
    if (!force && processedSources.current.has(key)) return;
    processedSources.current.add(key);
    const existingTimer = memoryTimers.current.get(source.learnerId);
    if (existingTimer) clearTimeout(existingTimer);
    const initial = latestLearning.current.profileOrigins[source.learnerId] === 'tutor_only';
    setMemoryStates((items) => ({
      ...items,
      [source.learnerId]: {
        status: 'updating',
        initial,
        sourceId: source.sourceId,
        assignmentId: source.id,
        latest: items[source.learnerId]?.latest ?? null,
      },
    }));
    memoryTimers.current.set(
      source.learnerId,
      setTimeout(() => {
        memoryTimers.current.delete(source.learnerId);
        const current = latestLearning.current.assignmentStore[source.id]?.saved;
        if (
          !current ||
          current.sourceId !== source.sourceId ||
          current.learnerId !== source.learnerId
        ) {
          setMemoryStates((items) => ({
            ...items,
            [source.learnerId]: {
              status: 'failed',
              initial,
              sourceId: source.sourceId,
              assignmentId: source.id,
              latest: null,
            },
          }));
          return;
        }
        if (fail) {
          setMemoryStates((items) => ({
            ...items,
            [source.learnerId]: { ...items[source.learnerId]!, status: 'failed' },
          }));
          return;
        }
        const owner = learners.find((item) => item.id === source.learnerId)!;
        if (initial && latestLearning.current.profileOrigins[source.learnerId] === 'tutor_only') {
          const established =
            latestLearning.current.profiles[source.learnerId] ?? seedProfile(owner);
          const enriched = { ...established };
          if (!enriched.focus.trim()) enriched.focus = source.guidance;
          if (source.sourceId === 'source-daniel-first' && !enriched.challenge.trim())
            enriched.challenge =
              'Rehearsing a question first helps with forming it in conversation.';
          const changes = profileChanges(established, enriched, {
            learnerId: source.learnerId,
            sourceAssignmentId: source.id,
            sourceId: source.sourceId,
            sourceTitle: source.content.title,
            reason: 'Initial context from the confirmed fictional lesson source.',
            updatedAt: new Date().toISOString(),
          }).filter(
            (change) =>
              !latestLearning.current.profileChangeLog.some((old) => old.id === change.id),
          );
          if (changes.length) {
            setProfileChangeLog((items) => [...changes, ...items]);
            setProfiles((items) => ({ ...items, [source.learnerId]: enriched }));
            setProfileVersions((items) => ({
              ...items,
              [source.learnerId]: [...(items[source.learnerId] ?? [established]), enriched],
            }));
            record(
              'Learner context enriched automatically',
              source.content.title,
              source.learnerId,
            );
          }
          setProfileOrigins((items) => ({ ...items, [source.learnerId]: 'evidence_enriched' }));
        }
        setMemoryStates((items) => ({
          ...items,
          [source.learnerId]: {
            status: 'ready',
            initial,
            sourceId: source.sourceId,
            assignmentId: source.id,
            latest: {
              summary: learningMemoryNotes[source.sourceId] ?? source.source,
              updatedAt: new Date().toISOString(),
              sourceId: source.sourceId,
              assignmentId: source.id,
            },
          },
        }));
        record('Learner memory updated', source.content.title, source.learnerId);
      }, 1800),
    );
  }
  startProcessing.current = startMemoryRefresh;
  useEffect(() => {
    startProcessing.current(
      latestLearning.current.assignmentStore['assignment-daniel']!.saved,
      true,
    );
    return () => {
      for (const timer of memoryTimers.current.values()) clearTimeout(timer);
    };
  }, []);
  function editProfile(value: ProfileData) {
    if (profileDraft === null)
      setProfileEditBase({
        learnerId: learner.id,
        version: profileVersion,
        profile: structuredClone(profileData),
      });
    setProfileDraft(value);
    setNotice('');
  }
  const profile = profileData.goal.split('\n')[0];
  const profileDirty =
    profileDraft !== null && JSON.stringify(profileDraft) !== JSON.stringify(profileData);
  const dirty =
    (view === 'learning' && profileDirty) ||
    (view === 'editor' && JSON.stringify(activeSlot.draft) !== JSON.stringify(activeSlot.saved));
  const historyBlocker = useBlocker(({ historyAction }) => historyAction === 'POP' && dirty);
  const learnerLessons = lessons.filter((item) => item.learnerId === learner.id);
  const upcoming = learnerLessons
    .filter(
      (item) =>
        item.state === 'Scheduled' &&
        new Date(`${item.date}T${item.time}:00+07:00`).getTime() > Date.now(),
    )
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  function record(label: string, detail: string, learnerId: string = learner.id) {
    setActivity((items) => [{ id: crypto.randomUUID(), learnerId, label, detail }, ...items]);
  }
  function move(
    next: StudioView,
    learnerId: string = learner.id,
    force = false,
    assignmentId?: string,
    lessonId?: string,
  ) {
    if (dirty && !force) {
      setPendingNavigation({ view: next, learnerId, assignmentId, lessonId });
      return;
    }
    const nextParams = new URLSearchParams(params);
    nextParams.set('studioView', next);
    nextParams.set('learner', learnerId);
    if (assignmentId) nextParams.set('assignment', assignmentId);
    if (next === 'editor' && assignmentId)
      setStage(assignmentStore[assignmentId]?.draft.unlocked ?? 1);
    setParams(nextParams);
    setProfileDraft(null);
    setProfileEditBase(null);
    setError('');
    setNotice('');
    setSelectedLesson(lessonId ?? null);
    setMobileMenu(false);
    requestAnimationFrame(() => mainHeading.current?.focus());
  }
  function saveEdits() {
    if (view === 'learning' && staleProfileDraft) {
      setError('Learner context changed in the background. Review the update before saving.');
      return false;
    }
    if (saveFailure) {
      setError(
        'Could not save. Your edits are still here. Try again when the connection is available.',
      );
      return false;
    }
    if (view === 'editor') return commitAssignment(activeSlot.draft);
    if (profileDraft !== null) {
      setProfiles((items) => ({ ...items, [learner.id]: profileDraft }));
      setProfileVersions((items) => ({
        ...items,
        [learner.id]: [...(items[learner.id] ?? [profileData]), structuredClone(profileDraft)],
      }));
      record('Learner profile saved', 'Active profile revision');
    }
    setProfileDraft(null);
    setProfileEditBase(null);
    setError('');
    setNotice('Saved in this preview');
    return true;
  }
  function createLessons(items: Lesson[]) {
    setLessons((existing) => [
      ...existing,
      ...items.filter((item) => !existing.some((known) => known.id === item.id)),
    ]);
    for (const item of items)
      record('Lesson scheduled', `${displayDate(item.date)} · ${item.time}`, item.learnerId);
  }
  function changeLesson(next: Lesson, label: string) {
    const previous = lessons.find((item) => item.id === next.id)!;
    const oldCharge = previous.state === 'Completed' && previous.charge ? 1 : 0;
    const newCharge = next.state === 'Completed' && next.charge ? 1 : 0;
    setLessons((items) => items.map((item) => (item.id === next.id ? next : item)));
    if (oldCharge !== newCharge)
      setBalances((items) => ({
        ...items,
        [next.learnerId]: (items[next.learnerId] ?? 0) + oldCharge - newCharge,
      }));
    record(
      label,
      `${displayDate(next.date)} · ${next.time}${oldCharge !== newCharge ? ` · credit balance ${oldCharge - newCharge > 0 ? 'restored' : 'charged'}` : ''}`,
      next.learnerId,
    );
    setNotice('Lesson updated in this preview');
  }
  function heading(title: string, action?: ReactNode, subtitle?: string) {
    return (
      <header className="cs2-page-heading">
        <div>
          <h1 ref={mainHeading} tabIndex={-1}>
            {title}
          </h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>
    );
  }
  function commitAssignment(next: StudioAssignment) {
    if (saveFailure) {
      setError('Could not save. Your edits are still here.');
      return false;
    }
    const invalid = next.unlocked >= 4 ? workbookError(next.content) : null;
    if (invalid) {
      setError(invalid);
      return false;
    }
    setAssignmentStore((items) => ({
      ...items,
      [next.id]: { saved: structuredClone(next), draft: next },
    }));
    if (next.source.trim() && (next.unlocked >= 2 || next.status === 'transcript'))
      startMemoryRefresh(next);
    if (next.status !== activeSlot.saved.status)
      record(
        next.status === 'published'
          ? 'Handout published locally'
          : next.status === 'transcript'
            ? 'Transcript-only lesson finished'
            : 'Homework preparation resumed',
        next.content.title,
        next.learnerId,
      );
    setError('');
    setNotice('Saved in this preview');
    return true;
  }
  function openAssignment(id = 'assignment-alex') {
    const assignment = assignmentStore[id]!.draft;
    if (!dirty) setStage(assignment.unlocked);
    move('editor', assignment.learnerId, false, id);
  }
  function startAssignment(lessonId: string | null = null) {
    setNewLessonId(lessonId);
    setNewAssignmentWillComplete(
      lessonNeedsHomeworkCompletion(lessons.find((item) => item.id === lessonId)),
    );
    setDialog('new-assignment');
  }
  function assignmentRow(slot: AssignmentSlot) {
    const assignment = slot.saved;
    const owner = learners.find((item) => item.id === assignment.learnerId)!;
    return (
      <button
        type="button"
        className="cs2-work-row"
        key={assignment.id}
        onClick={() => openAssignment(assignment.id)}
      >
        <FileText size={21} />
        <span>
          <strong>
            {assignment.content.title === 'Untitled assignment'
              ? 'Assignment in preparation'
              : assignment.content.title}
          </strong>
          <span>
            {owner.name} ·{' '}
            {assignment.status === 'published'
              ? 'Published handout'
              : assignment.status === 'transcript'
                ? 'Transcript-only lesson finished'
                : `Assignment · ${assignment.unlocked >= 4 ? 'Editing' : 'Preparation'} · saved draft`}
          </span>
        </span>
        <span>
          {assignment.status === 'draft' ? 'Resume' : 'Open'}
          <ArrowRight size={16} />
        </span>
      </button>
    );
  }
  function calendarStatus() {
    return (
      <div className={`cs2-calendar-status ${!connected ? 'cs2-calendar-off' : ''}`}>
        <span>
          <span className={`cs2-dot ${connected ? 'is-connected' : ''}`} />
          {connected ? 'Teaching calendar' : 'Calendar disconnected'}
          <span className="cs2-muted">
            {connected ? 'Synced just now' : 'Existing lessons remain available'}
          </span>
        </span>
        <button className="cs2-text-button" type="button" onClick={() => move('settings')}>
          {connected ? 'Manage' : 'Reconnect'}
          <ArrowRight size={14} />
        </button>
      </div>
    );
  }
  function scheduleAction() {
    return (
      <ProductButton
        icon={<Plus />}
        onClick={() => (connected ? setDialog('schedule') : move('settings'))}
      >
        {connected ? 'Schedule lesson' : 'Connect calendar'}
      </ProductButton>
    );
  }
  function lessonRows(items: Lesson[], showLearner = false) {
    return (
      <div className="cs2-lessons">
        {items.length ? (
          items.map((item) => {
            const person = learners.find((candidate) => candidate.id === item.learnerId)!;
            const linkedAssignment = Object.values(assignmentStore).find(
              (slot) => slot.saved.lessonId === item.id,
            );
            const completesForHomework = !linkedAssignment && lessonNeedsHomeworkCompletion(item);
            const canFinish =
              item.state === 'Scheduled' &&
              new Date(`${item.date}T${item.time}:00+07:00`).getTime() <= Date.now();
            return (
              <div className="cs2-lesson-wrap" key={item.id}>
                <div className="cs2-lesson-row">
                  <div className="cs2-lesson-time">
                    <strong>{item.time}</strong>
                    <span>{item.duration} min</span>
                  </div>
                  <div className="cs2-lesson-title">
                    {showLearner ? (
                      <button
                        type="button"
                        className="cs2-text-button cs2-name"
                        onClick={() => move('overview', person.id)}
                      >
                        {person.name}
                      </button>
                    ) : (
                      <strong>{displayDate(item.date)}</strong>
                    )}
                    <span>
                      {showLearner ? person.focus : item.notes || 'Lesson'}
                      {item.date !== today && showLearner ? ` · ${displayDate(item.date)}` : ''}
                    </span>
                  </div>
                  <div className="cs2-lesson-actions">
                    <span
                      className={`cs2-state ${item.state === 'Completed' ? 'cs2-success' : ''}`}
                    >
                      {item.state === 'Completed' && <Check size={14} />}
                      {item.state}
                    </span>
                    <button
                      type="button"
                      className="cs2-text-button"
                      aria-expanded={selectedLesson === item.id}
                      aria-label={`Details for ${person.name} on ${displayDate(item.date)} at ${item.time}`}
                      onClick={() => setSelectedLesson(selectedLesson === item.id ? null : item.id)}
                    >
                      Details
                      <ChevronDown size={15} />
                    </button>
                  </div>
                </div>
                {selectedLesson === item.id && (
                  <div className="cs2-lesson-detail">
                    <div className="cs2-row-actions">
                      <ProductButton
                        variant="secondary"
                        icon={<ExternalLink />}
                        onClick={() => setDialog('provider')}
                      >
                        Calendar event
                      </ProductButton>
                      {(linkedAssignment ||
                        item.state === 'Completed' ||
                        item.state === 'Scheduled') && (
                        <ProductButton
                          variant="secondary"
                          icon={<BookOpen />}
                          onClick={() =>
                            linkedAssignment
                              ? openAssignment(linkedAssignment.saved.id)
                              : startAssignment(item.id)
                          }
                        >
                          {linkedAssignment
                            ? 'Open homework'
                            : completesForHomework
                              ? 'Complete & add homework'
                              : item.state === 'Completed'
                                ? 'Add homework'
                                : 'Prepare homework'}
                          {completesForHomework && (
                            <span className="cs2-action-cost">−1 credit</span>
                          )}
                        </ProductButton>
                      )}
                      {canFinish && (
                        <>
                          <ProductButton
                            variant="secondary"
                            onClick={() => {
                              changeLesson({ ...item, state: 'Completed' }, 'Lesson completed');
                            }}
                          >
                            Complete lesson
                            <span className="cs2-action-cost">
                              {item.charge ? '−1 credit' : 'No charge'}
                            </span>
                          </ProductButton>
                          <ProductButton
                            variant="quiet"
                            onClick={() => {
                              changeLesson({ ...item, state: 'No-show' }, 'Lesson marked no-show');
                            }}
                          >
                            No-show
                          </ProductButton>
                        </>
                      )}
                    </div>
                    <details>
                      <summary>Edit notes & charge</summary>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const data = new FormData(event.currentTarget);
                          changeLesson(
                            {
                              ...item,
                              notes: String(data.get('notes')),
                              charge: data.get('charge') === 'on',
                              state:
                                item.state === 'Completed' || item.state === 'No-show'
                                  ? (String(data.get('outcome')) as Lesson['state'])
                                  : item.state,
                            },
                            'Lesson notes & outcome updated',
                          );
                        }}
                      >
                        {(item.state === 'Completed' || item.state === 'No-show') && (
                          <label>
                            Recorded outcome
                            <select name="outcome" defaultValue={item.state}>
                              <option>Completed</option>
                              <option>No-show</option>
                            </select>
                          </label>
                        )}
                        <label>
                          Notes
                          <textarea name="notes" defaultValue={item.notes} rows={2} />
                        </label>
                        <label className="cs2-check">
                          <input name="charge" type="checkbox" defaultChecked={item.charge} />{' '}
                          Chargeable lesson
                        </label>
                        <ProductButton type="submit" variant="secondary">
                          Save notes & charge
                        </ProductButton>
                      </form>
                    </details>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <p className="cs2-empty">No lessons in this window.</p>
        )}
      </div>
    );
  }

  function overview() {
    return (
      <>
        {heading(
          learner.name,
          <ProductButton variant="secondary" onClick={() => move('learning')}>
            Learning profile
            <ArrowRight size={16} />
          </ProductButton>,
          `${profileData.level || 'Level not recorded'} · English learning`,
        )}
        <div className="cs2-overview-grid">
          <section className="cs2-profile-summary">
            <h2>What we’re working toward</h2>
            <ContextContent state={contextState} onRetry={() => setContextState('ready')}>
              <p className="cs2-lead">{profile}</p>
              <dl>
                <div>
                  <dt>Current focus</dt>
                  <dd>{profileData.focus}</dd>
                </div>
                <div>
                  <dt>Worth remembering</dt>
                  <dd>{profileData.challenge.split('\n')[0]}</dd>
                </div>
                <div>
                  <dt>Interests</dt>
                  <dd>{profileData.interests.split('\n')[0]}</dd>
                </div>
              </dl>
            </ContextContent>
          </section>
          <aside className="cs2-practical">
            <h2>At a glance</h2>
            <div className="cs2-fact">
              <span>Lesson credits</span>
              <strong>{balances[learner.id] ?? 0}</strong>
            </div>
            <button type="button" className="cs2-text-button" onClick={() => move('billing')}>
              View billing
              <ArrowRight size={15} />
            </button>
            <hr />
            <span className="cs2-muted cs2-small">Learning profile</span>
            <p>
              {learnerChanges.length
                ? 'Profile updated automatically'
                : 'No recent profile changes'}
            </p>
            {learnerChanges.length > 0 && (
              <button
                type="button"
                className="cs2-text-button"
                onClick={() => setDialog('profile-changes')}
              >
                View changes <ArrowRight size={15} />
              </button>
            )}
          </aside>
        </div>
        <section>
          <div className="cs2-section-heading">
            <h2>Current work</h2>
            <button type="button" className="cs2-text-button" onClick={() => move('schedule')}>
              View schedule
              <ArrowRight size={15} />
            </button>
          </div>
          {upcoming.length > 0 ? (
            lessonRows(upcoming.slice(0, 1))
          ) : (
            <div className="cs2-empty-row">
              <p>No upcoming lesson in this window.</p>
            </div>
          )}
          {Object.values(assignmentStore)
            .filter((slot) => slot.saved.learnerId === learner.id)
            .map(assignmentRow)}
          <ProductButton variant="quiet" icon={<Plus />} onClick={() => startAssignment()}>
            Start assignment for {learner.name.split(' ')[0]}
          </ProductButton>
        </section>
        <section>
          <div className="cs2-section-heading">
            <h2>Recent activity</h2>
            <button type="button" className="cs2-text-button" onClick={() => move('history')}>
              View history
              <ArrowRight size={15} />
            </button>
          </div>
          {historyRows(true)}
        </section>
      </>
    );
  }
  function historyRows(compact = false) {
    const entries = activity.filter((item) => item.learnerId === learner.id);
    return (
      <div className="cs2-history">
        {entries.slice(0, compact ? 2 : undefined).map((item) => (
          <div key={item.id}>
            <span className="cs2-history-marker" />
            <div>
              <strong>{item.label}</strong>
              <p>{item.detail}</p>
            </div>
            <time>Today</time>
          </div>
        ))}
        {learner.id === 'alex' && (
          <>
            <div>
              <Check size={17} />
              <div>
                <strong>Lesson completed</strong>
                <p>Conversation · A change of plans</p>
              </div>
              <time>Today, 09:00</time>
            </div>
            {!compact && (
              <div>
                <FileText size={17} />
                <div>
                  <button
                    type="button"
                    className="cs2-text-button"
                    onClick={() => openAssignment()}
                  >
                    Assignment draft saved
                  </button>
                  <p>Ready to continue editing</p>
                </div>
                <time>Today</time>
              </div>
            )}
          </>
        )}
        {entries.length === 0 && learner.id !== 'alex' && (
          <p className="cs2-empty">No recent recorded activity in this preview.</p>
        )}
      </div>
    );
  }
  function learning() {
    return (
      <LearningWorkspace
        learner={learner}
        profile={profileData}
        draft={profileDraft}
        onDraft={editProfile}
        onSave={() => {
          const ok = saveEdits();
          if (ok) setContextState('ready');
          return ok;
        }}
        onCancel={() => {
          if (profileDirty) move('learning');
          else {
            setProfileDraft(null);
            setProfileEditBase(null);
          }
        }}
        onVersions={() => setDialog('versions')}
        version={profileVersions[learner.id]?.length ?? 1}
        contextState={contextState}
        onRetry={() => setContextState('ready')}
        assignments={Object.values(assignmentStore)
          .map((slot) => slot.saved)
          .filter((item) => item.learnerId === learner.id)}
        lessons={learnerLessons}
        onAssignment={openAssignment}
        onLesson={(id) => move('schedule', learner.id, false, undefined, id)}
        onStartAssignment={() => startAssignment()}
        changes={learnerChanges}
        onChanges={() => setDialog('profile-changes')}
        notice={notice}
        memory={
          memoryStates[learner.id] ?? {
            status: 'idle',
            initial: false,
            sourceId: null,
            assignmentId: null,
            latest: null,
          }
        }
        onRetryMemory={() => {
          const source = Object.values(assignmentStore)
            .map((slot) => slot.saved)
            .find(
              (item) =>
                item.learnerId === learner.id &&
                item.source.trim() &&
                (item.unlocked > 1 || item.status === 'transcript'),
            );
          if (source) startMemoryRefresh(source, true, false);
        }}
        profileOrigin={profileOrigins[learner.id] ?? 'tutor_only'}
        staleDraft={staleProfileDraft}
        onReviewUpdate={() => {
          setMergeChoices({});
          setDialog('profile-update');
        }}
        headingRef={mainHeading}
      />
    );
  }
  function schedule() {
    return (
      <>
        {heading('Schedule', scheduleAction(), 'Ho Chi Minh City · UTC+07:00')}
        {calendarStatus()}
        <section>
          <div className="cs2-section-heading">
            <h2>Today</h2>
            <span>{displayDate(today)}</span>
          </div>
          {lessonRows(learnerLessons.filter((item) => item.date === today))}
        </section>
        <section>
          <div className="cs2-section-heading">
            <h2>Upcoming</h2>
          </div>
          {lessonRows(upcoming.filter((item) => item.date > today))}
        </section>
        <details className="cs2-recent">
          <summary>Recent lessons</summary>
          {lessonRows(learnerLessons.filter((item) => item.date < today))}
        </details>
        <div className="cs2-schedule-footer">
          <button
            type="button"
            className="cs2-text-button"
            disabled={!connected}
            onClick={() => setDialog('associate')}
          >
            Associate an existing Google event
            <ArrowRight size={15} />
          </button>
          <span>
            {balances[learner.id] ?? 0} lesson credits{' '}
            <button type="button" className="cs2-text-button" onClick={() => move('billing')}>
              View billing
            </button>
          </span>
        </div>
        {!connected && (
          <p className="cs2-muted cs2-small">
            Connect the calendar to create lessons or associate events. Recorded lessons and billing
            remain available.
          </p>
        )}
      </>
    );
  }
  function day() {
    return (
      <>
        {heading('Your day', scheduleAction(), displayDate(today, true))}
        {calendarStatus()}
        <section>
          <div className="cs2-section-heading">
            <h2>Today</h2>
            <span>Ho Chi Minh City · UTC+07:00</span>
          </div>
          {lessonRows(
            lessons
              .filter((item) => item.date === today)
              .sort((a, b) => a.time.localeCompare(b.time)),
            true,
          )}
        </section>
        <section>
          <div className="cs2-section-heading">
            <h2>Continue working</h2>
            <span>Saved work, without a deadline</span>
          </div>
          {Object.values(assignmentStore)
            .filter((slot) => slot.saved.status === 'draft')
            .map(assignmentRow)}
        </section>
      </>
    );
  }
  function billing() {
    return (
      <>
        {heading('Billing')}
        <section className="cs2-credit-panel" aria-labelledby="cs2-credit-title">
          <div className="cs2-credit-overview">
            <div className="cs2-credit-total">
              <strong>{balances[learner.id] ?? 0}</strong>
              <h2 id="cs2-credit-title">Lesson credits</h2>
            </div>
            <ProductButton variant="secondary" icon={<Plus />} onClick={() => setDialog('credits')}>
              Add lesson credits
            </ProductButton>
          </div>
          <div className="cs2-credit-footer">
            <button className="cs2-text-button" type="button" onClick={() => move('schedule')}>
              <CalendarDays size={15} /> View schedule
            </button>
            <details className="cs2-lesson-defaults">
              <summary>Lesson defaults</summary>
              <dl>
                <div>
                  <dt>Duration</dt>
                  <dd>60 minutes</dd>
                </div>
                <div>
                  <dt>Default charge</dt>
                  <dd>One lesson credit</dd>
                </div>
              </dl>
            </details>
          </div>
        </section>
        <section className="cs2-payment-section">
          <div className="cs2-billing-section-heading">
            <h2>Payments</h2>
            <ProductButton icon={<Plus />} onClick={() => setDialog('payment')}>
              Record payment
            </ProductButton>
          </div>
          <div className="cs2-payment-table" role="table" aria-label="Recorded payments">
            {payments.some((item) => item.learnerId === learner.id) && (
              <div className="cs2-table-header" role="row">
                <span role="columnheader">Date</span>
                <span role="columnheader">Amount</span>
              </div>
            )}
            {payments
              .filter((item) => item.learnerId === learner.id)
              .map((item) => (
                <div key={item.id} role="row">
                  <span role="cell">
                    <time dateTime={item.date}>{displayDate(item.date)}</time>
                  </span>
                  <strong role="cell">USD {item.amount}</strong>
                </div>
              ))}
            {!payments.some((item) => item.learnerId === learner.id) && (
              <p className="cs2-empty">No payments recorded.</p>
            )}
          </div>
        </section>
      </>
    );
  }
  function assignments() {
    const slots = Object.values(assignmentStore).filter(
      (slot) => assignmentFilter === 'all' || slot.saved.status === assignmentFilter,
    );
    return (
      <>
        {heading(
          'Assignments',
          <ProductButton icon={<Plus />} onClick={() => startAssignment()}>
            Start assignment
          </ProductButton>,
        )}
        <label className="cs2-list-filter">
          Show
          <select
            value={assignmentFilter}
            onChange={(event) => setAssignmentFilter(event.target.value)}
          >
            <option value="all">All work</option>
            <option value="draft">In progress</option>
            <option value="published">Published</option>
            <option value="transcript">Transcript-only</option>
          </select>
        </label>
        {slots.length ? (
          slots.map(assignmentRow)
        ) : (
          <p className="cs2-empty">No assignments match this view.</p>
        )}
      </>
    );
  }
  function editor() {
    const linkedLesson = lessons.find((item) => item.id === activeSlot.draft.lessonId);
    return (
      <AssignmentWorkspace
        key={activeSlot.draft.id}
        slot={activeSlot}
        learner={learner}
        step={Math.min(stage, activeSlot.draft.unlocked)}
        onStep={setStage}
        onChange={(next) =>
          setAssignmentStore((items) => ({
            ...items,
            [next.id]: { saved: items[next.id]!.saved, draft: next },
          }))
        }
        onCommit={commitAssignment}
        onBack={() => move('assignments')}
        onOpenExisting={openAssignment}
        knownSources={Object.values(assignmentStore)
          .map((slot) => slot.saved)
          .filter(
            (item) =>
              item.id !== activeSlot.saved.id &&
              item.learnerId === learner.id &&
              item.source.trim(),
          )}
        saveFailure={saveFailure}
        lessonLabel={
          linkedLesson ? `${displayDate(linkedLesson.date)} · ${linkedLesson.time}` : undefined
        }
      />
    );
  }
  function settings() {
    return (
      <>
        {heading('Workspace settings')}
        <section className="cs2-focused-form">
          <h2>Google Calendar</h2>
          <div className="cs2-setting-row">
            <div>
              <strong>{connected ? 'Teaching calendar' : 'Not connected'}</strong>
              <p>
                {connected
                  ? 'Connected · ESL teaching'
                  : 'Scheduling needs a selected Google Calendar.'}
              </p>
            </div>
            <ProductButton
              variant="secondary"
              onClick={() => {
                setConnected(!connected);
                setNotice(
                  connected
                    ? 'Disconnected in preview'
                    : 'Connected in preview. No Google authorization was performed.',
                );
              }}
            >
              {connected ? 'Disconnect in preview' : 'Connect in preview'}
            </ProductButton>
          </div>
          <details>
            <summary>Permissions & privacy</summary>
            <p>
              The real connection flow must show its full disclosures before authorization. This
              preview does not request permission, read a Google account or send invitations.
            </p>
            <a href="/privacy" target="_blank" rel="noreferrer">
              Read the privacy policy
              <ExternalLink size={14} />
            </a>
          </details>
          <hr />
          <label>
            Tutor timezone<span className="cs2-input-readonly">Ho Chi Minh City · UTC+07:00</span>
          </label>
          <p className="cs2-muted cs2-small">
            One tutor clock across this preview. Existing series keep their original recurrence
            timezone.
          </p>
        </section>
      </>
    );
  }

  return (
    <div className="cs2">
      <a className="cs2-skip" href="#cs2-main">
        Skip to workspace
      </a>
      <div className="cs2-sandbox-bar">
        <span>
          <strong>Calm Studio v2</strong>
          <span>Fictional data · resets on reload</span>
        </span>
        <details>
          <summary>
            <Settings2 size={14} /> Preview states
          </summary>
          <div className="cs2-preview-controls">
            <label>
              Learner context
              <select
                value={contextState}
                onChange={(event) => setContextState(event.target.value as ContextState)}
              >
                <option value="ready">Ready</option>
                <option value="empty">No context</option>
                <option value="unavailable">Unavailable</option>
              </select>
            </label>
            <label>
              Calendar
              <select
                value={String(connected)}
                onChange={(event) => setConnected(event.target.value === 'true')}
              >
                <option value="true">Connected</option>
                <option value="false">Disconnected</option>
              </select>
            </label>
            <label>
              Creation outcome
              <select
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as typeof outcome)}
              >
                <option value="success">Success</option>
                <option value="partial">Partial (add two weekly times)</option>
                <option value="failure">Failure</option>
              </select>
            </label>
            <label className="cs2-check">
              <input
                type="checkbox"
                checked={saveFailure}
                onChange={(event) => setSaveFailure(event.target.checked)}
              />{' '}
              Profile / assignment save failure
            </label>
            <label className="cs2-check">
              <input
                type="checkbox"
                checked={memoryFailure}
                onChange={(event) => setMemoryFailure(event.target.checked)}
              />
              Fail next background-memory preview
            </label>
            <ProductButton
              variant="secondary"
              onClick={() => {
                const source = Object.values(assignmentStore)
                  .map((slot) => slot.saved)
                  .find(
                    (item) =>
                      item.learnerId === learner.id &&
                      item.source.trim() &&
                      (item.unlocked > 1 || item.status === 'transcript'),
                  );
                if (source) startMemoryRefresh(source, true);
                else setNotice('Confirm a lesson source to preview a background update.');
              }}
            >
              Simulate background refresh
            </ProductButton>
            <a href="/">
              Current UI
              <ArrowRight size={14} />
            </a>
          </div>
        </details>
      </div>
      <div className="cs2-layout">
        <aside className={`cs2-sidebar ${mobileMenu ? 'is-open' : ''}`}>
          <button type="button" className="cs2-brand" onClick={() => move('day')}>
            <span className="cs2-brand-symbol">
              <BookOpen size={19} />
            </span>
            <span>ESL Pipeline</span>
          </button>
          <nav aria-label="Workspace">
            <button
              type="button"
              aria-current={view === 'assignments' || view === 'editor' ? 'page' : undefined}
              onClick={() => move('assignments')}
            >
              <FileText />
              Assignments
            </button>
            <button
              type="button"
              aria-current={isStudent ? 'page' : undefined}
              onClick={() => move('overview')}
            >
              <Users />
              Students
            </button>
            <button
              type="button"
              aria-current={view === 'day' || view === 'settings' ? 'page' : undefined}
              onClick={() => move('day')}
            >
              <CalendarDays />
              Business
            </button>
          </nav>
          {(view === 'day' || view === 'settings') && (
            <nav className="cs2-business-nav" aria-label="Business">
              <button
                type="button"
                aria-current={view === 'day' ? 'page' : undefined}
                onClick={() => move('day')}
              >
                Agenda
              </button>
              <button
                type="button"
                aria-current={view === 'settings' ? 'page' : undefined}
                onClick={() => move('settings')}
              >
                Settings
              </button>
            </nav>
          )}
          <div className="cs2-sidebar-bottom">
            <span className="cs2-avatar cs2-avatar-small">AT</span>
            <div>
              <strong>Alex Taylor</strong>
              <span>Tutor workspace</span>
            </div>
          </div>
        </aside>
        {isStudent && (
          <aside className="cs2-roster" aria-label="Student directory">
            <div className="cs2-roster-title">
              <h2>
                Students <span>{learners.length}</span>
              </h2>
              <button
                type="button"
                className="cs2-icon-button"
                aria-label="Add student"
                title="Add student"
                onClick={() => setDialog('new-student')}
              >
                <Plus size={20} />
              </button>
            </div>
            <label className="cs2-search">
              <Search size={16} />
              <input
                aria-label="Find a student"
                placeholder="Find a student"
                value={rosterSearch}
                onChange={(event) => setRosterSearch(event.target.value)}
              />
            </label>
            <nav aria-label="Students">
              {learners
                .filter((item) => item.name.toLowerCase().includes(rosterSearch.toLowerCase()))
                .map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-current={!missingLearner && learner.id === item.id ? 'true' : undefined}
                    onClick={() => move(view, item.id)}
                  >
                    <span className="cs2-avatar">{item.initials}</span>
                    <span>
                      <strong>{item.name}</strong>
                      <span>
                        {(profiles[item.id]?.level ?? item.level) || 'Level not recorded'} · English
                      </span>
                    </span>
                  </button>
                ))}
            </nav>
          </aside>
        )}
        <div className="cs2-content">
          <div className="cs2-mobile-header">
            <button
              className="cs2-icon-button"
              type="button"
              aria-label="Toggle workspace menu"
              aria-expanded={mobileMenu}
              onClick={() => setMobileMenu(!mobileMenu)}
            >
              <Menu size={21} />
            </button>
            <strong>ESL Pipeline</strong>
            <span>{isStudent ? learner.initials : 'Workspace'}</span>
          </div>
          {isStudent && (
            <>
              <div className="cs2-learner-heading">
                <span className="cs2-avatar">{missingLearner ? '?' : learner.initials}</span>
                <strong>{missingLearner ? 'Student unavailable' : learner.name}</strong>
                {!missingLearner && (
                  <span className="cs2-level-badge">
                    {profileData.level || 'Level not recorded'}
                  </span>
                )}
                <select
                  aria-label="Select learner"
                  value={missingLearner ? '' : learner.id}
                  onChange={(event) => move(view, event.target.value)}
                >
                  {missingLearner && (
                    <option value="" disabled>
                      Choose a student
                    </option>
                  )}
                  {learners.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="cs2-icon-button cs2-add-student-mobile"
                  aria-label="Add student"
                  onClick={() => setDialog('new-student')}
                >
                  <Plus size={20} />
                </button>
              </div>
              <nav className="cs2-student-tabs" aria-label="Student sections">
                {studentViews.map((section) => (
                  <button
                    type="button"
                    key={section}
                    aria-current={view === section ? 'page' : undefined}
                    onClick={() => move(section)}
                  >
                    {sectionLabels[section]}
                  </button>
                ))}
              </nav>
            </>
          )}
          <main id="cs2-main" className={`cs2-main ${view === 'editor' ? 'cs2-main-editor' : ''}`}>
            {error && (
              <div role="alert" className="cs2-message cs2-error">
                {error}
              </div>
            )}
            {notice && view !== 'learning' && (
              <div role="status" className="cs2-message">
                {notice}
              </div>
            )}
            {missingLearner && isStudent ? (
              <section className="cs2-unavailable">
                <h1>This sandbox student was reset</h1>
                <p>
                  Students added in this preview are kept until reload. Choose a student from the
                  roster.
                </p>
              </section>
            ) : (
              <>
                {view === 'overview' && overview()}
                {view === 'learning' && learning()}
                {view === 'schedule' && schedule()}
                {view === 'day' && day()}
                {view === 'billing' && billing()}
                {view === 'assignments' && assignments()}
                {view === 'editor' &&
                  (missingAssignment ? (
                    <section>
                      <h1>This sandbox assignment was reset</h1>
                      <p className="cs2-muted">
                        Assignments created in this preview live only in the current tab session.
                      </p>
                      <ProductButton onClick={() => move('assignments')}>
                        Open assignments
                      </ProductButton>
                    </section>
                  ) : (
                    editor()
                  ))}
                {view === 'settings' && settings()}
                {view === 'history' && (
                  <>
                    {heading('History')}
                    {historyRows()}
                    <details className="cs2-recent">
                      <summary>History coverage</summary>
                      <p className="cs2-muted cs2-small">
                        Recorded activity in this preview. Older or unavailable records are not
                        implied to be absent.
                      </p>
                    </details>
                  </>
                )}
              </>
            )}
          </main>
        </div>
      </div>
      {dialog === 'schedule' && (
        <SchedulingDrawer
          learner={learner}
          learners={learners}
          chooseLearner={view === 'day'}
          outcome={outcome}
          onCreate={createLessons}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'new-student' && (
        <StudioDialog title="Add student" onClose={() => setDialog(null)}>
          <form
            className="cs2-dialog-body"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const name = String(form.get('name') ?? '').trim();
              if (!name) return;
              const id = `student-${crypto.randomUUID()}`;
              const level = String(form.get('level') ?? '').trim();
              const goal = String(form.get('goal') ?? '').trim();
              const student: Learner = {
                id,
                name,
                initials: name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((word) => word[0])
                  .join('')
                  .toUpperCase(),
                level,
                email: String(form.get('email') ?? '').trim(),
                goal,
                focus: '',
                interests: '',
                challenge: '',
                balance: 0,
              };
              const profile = Object.fromEntries(
                profileFields.map((field) => [field.key, '']),
              ) as ProfileData;
              profile.level = level;
              profile.goal = goal;
              setLearners((items) => [...items, student]);
              setProfiles((items) => ({ ...items, [id]: profile }));
              setProfileOrigins((items) => ({ ...items, [id]: 'tutor_only' }));
              setBalances((items) => ({ ...items, [id]: 0 }));
              setRosterSearch('');
              setContextState('ready');
              setDialog(null);
              record('Student added', name, id);
              move('learning', id);
            }}
          >
            <label>
              Student name
              <input name="name" required pattern=".*\S.*" autoComplete="off" autoFocus />
            </label>
            <div className="cs2-two-fields">
              <label>
                Current level
                <input name="level" placeholder="Optional" />
              </label>
              <label>
                Email
                <input name="email" type="email" placeholder="Optional" autoComplete="off" />
              </label>
            </div>
            <label>
              Learning goal
              <textarea name="goal" rows={3} placeholder="Optional" />
            </label>
            <p className="cs2-muted cs2-small">Added students reset when this sandbox reloads.</p>
            <footer className="cs2-form-footer">
              <ProductButton type="button" variant="quiet" onClick={() => setDialog(null)}>
                Cancel
              </ProductButton>
              <ProductButton type="submit">Add student</ProductButton>
            </footer>
          </form>
        </StudioDialog>
      )}
      {dialog === 'credits' && (
        <StudioDialog title="Add lesson credits" onClose={() => setDialog(null)}>
          <form
            className="cs2-dialog-body"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const quantity = Number(form.get('quantity'));
              setBalances((items) => ({
                ...items,
                [learner.id]: (items[learner.id] ?? 0) + quantity,
              }));
              record('Lesson credits added', `+${quantity} · ${form.get('label')}`);
              setDialog(null);
              setNotice('Credits added. No payment record was created.');
            }}
          >
            <p>{learner.name}</p>
            <label>
              Number of lesson credits
              <input
                type="number"
                name="quantity"
                min="1"
                max="100"
                step="1"
                required
                defaultValue="4"
              />
            </label>
            <label className="cs2-profile-field">
              Package label
              <input name="label" required defaultValue="Lesson package" />
            </label>
            <p className="cs2-muted cs2-small">
              Credits and recorded payments are separate. This changes the learner’s credit balance
              only.
            </p>
            <footer className="cs2-form-footer">
              <ProductButton type="button" variant="quiet" onClick={() => setDialog(null)}>
                Cancel
              </ProductButton>
              <ProductButton type="submit">Add credits</ProductButton>
            </footer>
          </form>
        </StudioDialog>
      )}
      {dialog === 'new-assignment' && (
        <StudioDialog
          title={newLessonId ? 'Add homework' : 'Start assignment'}
          onClose={() => setDialog(null)}
        >
          <form
            className="cs2-dialog-body"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const owner = learners.find((item) => item.id === data.get('learner'))!;
              // Recheck the lesson end at confirmation. If it became eligible while
              // the dialog was open, show the credit effect before allowing creation.
              const needsCompletion = lessonNeedsHomeworkCompletion(newAssignmentLesson);
              if (needsCompletion && !newAssignmentCompletionPreview) {
                setNewAssignmentWillComplete(true);
                return;
              }
              const assignment = newAssignment(owner, newLessonId);
              const established = profiles[owner.id] ?? seedProfile(owner);
              assignment.context = profileFields
                .filter((field) => established[field.key].trim())
                .map((field) => `${field.label}\n${established[field.key]}`)
                .join('\n\n');
              setAssignmentStore((items) => ({
                ...items,
                [assignment.id]: { saved: assignment, draft: structuredClone(assignment) },
              }));
              if (needsCompletion && newAssignmentLesson)
                changeLesson(
                  { ...newAssignmentLesson, state: 'Completed', charge: true },
                  'Lesson completed with homework',
                );
              setStage(1);
              setDialog(null);
              move('editor', owner.id, false, assignment.id);
            }}
          >
            <label>
              Learner
              <select
                name="learner"
                defaultValue={
                  newLessonId
                    ? lessons.find((item) => item.id === newLessonId)!.learnerId
                    : learner.id
                }
              >
                {learners
                  .filter(
                    (item) =>
                      !newLessonId ||
                      item.id === lessons.find((lesson) => lesson.id === newLessonId)!.learnerId,
                  )
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            {newAssignmentLesson ? (
              <div className="cs2-homework-lesson">
                <p>
                  {displayDate(newAssignmentLesson.date)} · {newAssignmentLesson.time} ·{' '}
                  {newAssignmentLesson.duration} min
                </p>
                {newAssignmentCompletionPreview && (
                  <dl className="cs2-homework-impact">
                    <div>
                      <dt>Lesson</dt>
                      <dd>
                        Scheduled <ArrowRight size={14} aria-hidden="true" /> Completed
                      </dd>
                    </div>
                    <div>
                      <dt>Lesson credits</dt>
                      <dd>
                        {balances[newAssignmentLesson.learnerId] ?? 0}{' '}
                        <ArrowRight size={14} aria-hidden="true" />{' '}
                        {(balances[newAssignmentLesson.learnerId] ?? 0) - 1}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
            ) : null}
            <footer className="cs2-form-footer">
              <ProductButton type="button" variant="quiet" onClick={() => setDialog(null)}>
                Cancel
              </ProductButton>
              <ProductButton type="submit" icon={newLessonId ? <BookOpen /> : undefined}>
                {newAssignmentCompletionPreview
                  ? 'Complete & add homework'
                  : newLessonId
                    ? 'Choose lesson material'
                    : 'Choose source'}
                {!newLessonId && <ArrowRight size={16} />}
              </ProductButton>
            </footer>
          </form>
        </StudioDialog>
      )}
      {dialog === 'profile-changes' && (
        <StudioDialog title="Profile updates" onClose={() => setDialog(null)}>
          <div className="cs2-dialog-body">
            <div className="cs2-updates-meta">
              <strong>{learner.name}</strong>
              <span>{learnerChanges.length} changes</span>
            </div>
            <ol className="cs2-profile-changes">
              {learnerChanges.map((change) => {
                const laterEdit =
                  change.status === 'applied' && profileData[change.field] !== change.after;
                const previousLines = change.before.split('\n').filter(Boolean);
                const updatedLines = change.after.split('\n').filter(Boolean);
                const removed = previousLines
                  .filter((line) => !updatedLines.includes(line))
                  .join('\n');
                const added = updatedLines
                  .filter((line) => !previousLines.includes(line))
                  .join('\n');
                const reverted = change.status === 'undone';
                return (
                  <li
                    key={change.id}
                    className={change.status === 'undone' ? 'cs2-change-undone' : ''}
                  >
                    <div className="cs2-change-heading">
                      <div className="cs2-change-title">
                        <h3>{profileFields.find((field) => field.key === change.field)!.label}</h3>
                        <span
                          className={`cs2-change-label cs2-change-label-${!removed ? 'new' : !added ? 'removed' : 'changed'}`}
                        >
                          {!removed ? 'New' : !added ? 'Removed' : 'Changed'}
                        </span>
                      </div>
                      <ProductButton
                        variant="quiet"
                        icon={change.status === 'undone' ? <Check /> : <RotateCcw />}
                        disabled={change.status === 'undone' || laterEdit}
                        aria-label={change.status === 'undone' ? 'Undone' : 'Undo'}
                        title={laterEdit ? 'This field has newer edits' : undefined}
                        onClick={() => {
                          const restored = undoProfileChange(profileData, change);
                          if (!restored) return;
                          setProfiles((items) => ({ ...items, [learner.id]: restored }));
                          setProfileVersions((items) => ({
                            ...items,
                            [learner.id]: [...(items[learner.id] ?? [profileData]), restored],
                          }));
                          setProfileChangeLog((items) =>
                            items.map((item) =>
                              item.id === change.id ? { ...item, status: 'undone' } : item,
                            ),
                          );
                          record(
                            'Profile update undone',
                            profileFields.find((field) => field.key === change.field)!.label,
                          );
                        }}
                      >
                        {change.status === 'undone' ? 'Reverted' : 'Undo'}
                      </ProductButton>
                    </div>
                    <div className={`cs2-change-diff${reverted ? ' cs2-diff-reverted' : ''}`}>
                      <div className="cs2-diff-before">
                        <span className="cs2-diff-label">Before</span>
                        <p>{removed || '—'}</p>
                      </div>
                      <ArrowRight className="cs2-diff-arrow" size={17} aria-hidden="true" />
                      <div className="cs2-diff-now">
                        <span className="cs2-diff-label">
                          {laterEdit ? 'Now · Edited later' : 'Now'}
                        </span>
                        {laterEdit ? (
                          <p>{profileData[change.field] || '—'}</p>
                        ) : reverted ? (
                          <>
                            <p>{removed || '—'}</p>
                            {added && <del>{added}</del>}
                          </>
                        ) : (
                          <p>{added || '—'}</p>
                        )}
                      </div>
                    </div>
                    <details>
                      <summary>Teaching notes</summary>
                      <p className="cs2-muted">{change.reason}</p>
                      <p className="cs2-muted cs2-small">
                        {displayDate(change.updatedAt.slice(0, 10))}
                      </p>
                      {assignmentStore[change.sourceAssignmentId]?.saved.sourceId ===
                        change.sourceId && (
                        <button
                          type="button"
                          className="cs2-text-button"
                          aria-label={`Open teaching notes: ${change.sourceTitle}`}
                          onClick={() => {
                            setDialog(null);
                            openAssignment(change.sourceAssignmentId);
                          }}
                        >
                          <BookOpen size={16} aria-hidden="true" /> {change.sourceTitle}
                        </button>
                      )}
                    </details>
                  </li>
                );
              })}
            </ol>
          </div>
        </StudioDialog>
      )}
      {dialog === 'profile-update' && profileDraft && profileEditBase && (
        <StudioDialog title="Review background learner context" onClose={() => setDialog(null)}>
          <div className="cs2-dialog-body">
            <p>
              The active profile was updated while you were editing. Your changes have been kept.
            </p>
            <div className="cs2-background-comparison">
              {profileFields
                .filter(
                  (field) =>
                    profileEditBase.profile[field.key] !== profileData[field.key] ||
                    profileDraft[field.key] !== profileEditBase.profile[field.key],
                )
                .map((field) => {
                  const mineChanged =
                    profileDraft[field.key] !== profileEditBase.profile[field.key];
                  const latestChanged =
                    profileData[field.key] !== profileEditBase.profile[field.key];
                  const conflict =
                    mineChanged &&
                    latestChanged &&
                    profileDraft[field.key] !== profileData[field.key];
                  return (
                    <section key={field.key}>
                      <h3>{field.label}</h3>
                      <div className="cs2-suggestion-comparison">
                        <div>
                          <span>Your draft</span>
                          <p>{profileDraft[field.key] || 'Not recorded'}</p>
                        </div>
                        <div>
                          <span>Latest profile</span>
                          <p>{profileData[field.key] || 'Not recorded'}</p>
                        </div>
                      </div>
                      {conflict ? (
                        <fieldset className="cs2-choice">
                          <legend>Keep in the reviewed draft</legend>
                          <label>
                            <input
                              type="radio"
                              name={'merge-' + field.key}
                              checked={(mergeChoices[field.key] ?? 'mine') === 'mine'}
                              onChange={() =>
                                setMergeChoices((items) => ({ ...items, [field.key]: 'mine' }))
                              }
                            />
                            My wording
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={'merge-' + field.key}
                              checked={mergeChoices[field.key] === 'latest'}
                              onChange={() =>
                                setMergeChoices((items) => ({ ...items, [field.key]: 'latest' }))
                              }
                            />
                            Background wording
                          </label>
                        </fieldset>
                      ) : (
                        <p className="cs2-muted cs2-small">
                          {mineChanged
                            ? 'Your edit will be kept.'
                            : 'New background context will be added.'}
                        </p>
                      )}
                    </section>
                  );
                })}
            </div>
            <footer className="cs2-form-footer">
              <ProductButton
                variant="quiet"
                onClick={() => {
                  setProfileDraft(null);
                  setProfileEditBase(null);
                  setDialog(null);
                }}
              >
                Use latest profile
              </ProductButton>
              <ProductButton
                onClick={() => {
                  const merged = { ...profileData };
                  for (const field of profileFields) {
                    if (
                      profileDraft[field.key] !== profileEditBase.profile[field.key] &&
                      mergeChoices[field.key] !== 'latest'
                    )
                      merged[field.key] = profileDraft[field.key];
                  }
                  setProfileDraft(merged);
                  setProfileEditBase({
                    learnerId: learner.id,
                    version: profileVersion,
                    profile: structuredClone(profileData),
                  });
                  setError('');
                  setDialog(null);
                }}
              >
                Review merged draft
              </ProductButton>
            </footer>
          </div>
        </StudioDialog>
      )}
      {dialog === 'versions' && (
        <StudioDialog title="Profile versions" onClose={() => setDialog(null)}>
          <div className="cs2-dialog-body">
            {profileDirty && (
              <p className="cs2-inline-warning">
                Save or discard your open draft before restoring a version.
              </p>
            )}
            {(profileVersions[learner.id] ?? [profileData]).map((version, index, all) => (
              <section className="cs2-profile-version" key={index}>
                <h3>
                  Version {index + 1}
                  {index === all.length - 1 ? ' · current' : ''}
                </h3>
                <p>{version.goal}</p>
                <p className="cs2-muted">{version.focus}</p>
                {index < all.length - 1 && (
                  <ProductButton
                    variant="secondary"
                    disabled={profileDirty}
                    onClick={() => {
                      setDialog(null);
                      if (view !== 'learning') move('learning');
                      setProfileEditBase({
                        learnerId: learner.id,
                        version: profileVersion,
                        profile: structuredClone(profileData),
                      });
                      editProfile(structuredClone(version));
                    }}
                  >
                    Use as profile draft
                  </ProductButton>
                )}
              </section>
            ))}
            <p className="cs2-muted cs2-small">
              Viewing a version does not change the active profile. A restored draft needs an
              explicit save.
            </p>
          </div>
        </StudioDialog>
      )}
      {dialog === 'provider' && selectedLessonData && (
        <CalendarEventDialog
          learner={learners.find((item) => item.id === selectedLessonData.learnerId)!}
          lesson={selectedLessonData}
          onChange={(next) =>
            changeLesson(
              next,
              next.state === 'Canceled' ? 'Calendar event canceled' : 'Calendar event rescheduled',
            )
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'associate' && (
        <StudioDialog title="Associate an existing event" onClose={() => setDialog(null)}>
          <form
            className="cs2-dialog-body"
            onSubmit={(event) => {
              event.preventDefault();
              const choice = String(new FormData(event.currentTarget).get('event'));
              const eventTime = choice === 'sample-event-1' ? '18:30' : '19:30';
              createLessons([
                {
                  id: choice,
                  learnerId: learner.id,
                  date: today,
                  time: eventTime,
                  duration: 60,
                  state: 'Scheduled',
                  notes: 'Explicitly associated Google event',
                  charge: true,
                },
              ]);
              setDialog(null);
              setNotice('Selected event associated with ' + learner.name);
            }}
          >
            <p>
              Choose the exact event to link to <strong>{learner.name}</strong>.
            </p>
            {['sample-event-1', 'sample-event-2'].filter(
              (id) => !lessons.some((item) => item.id === id),
            ).length ? (
              <>
                <label>
                  Unlinked event
                  <select name="event" required defaultValue="">
                    <option value="" disabled>
                      Select an event
                    </option>
                    {['sample-event-1', 'sample-event-2']
                      .filter((id) => !lessons.some((item) => item.id === id))
                      .map((id) => (
                        <option key={id} value={id}>
                          {id === 'sample-event-1'
                            ? 'English conversation · 18:30'
                            : 'Evening lesson · 19:30'}{' '}
                          · {displayDate(today)} · Teaching calendar
                        </option>
                      ))}
                  </select>
                </label>
                <p className="cs2-muted cs2-small">
                  Event titles and guests do not establish learner identity.
                </p>
                <footer className="cs2-form-footer">
                  <ProductButton type="button" variant="quiet" onClick={() => setDialog(null)}>
                    Cancel
                  </ProductButton>
                  <ProductButton type="submit">Associate selected event</ProductButton>
                </footer>
              </>
            ) : (
              <p className="cs2-empty">
                All sample events are already associated. No unlinked events remain.
              </p>
            )}
          </form>
        </StudioDialog>
      )}
      {dialog === 'payment' && (
        <StudioDialog title="Record payment" onClose={() => setDialog(null)}>
          <form
            className="cs2-dialog-body"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setPayments((items) => [
                ...items,
                {
                  id: crypto.randomUUID(),
                  learnerId: learner.id,
                  date: String(form.get('date')),
                  amount: Number(form.get('amount')).toFixed(2),
                },
              ]);
              record('Payment recorded', `USD ${form.get('amount')}`);
              setDialog(null);
              setNotice('Payment recorded in preview. No credit package was added.');
            }}
          >
            <p>{learner.name}</p>
            <div className="cs2-form-grid">
              <label>
                Amount (USD)
                <input required type="number" name="amount" min="0.01" step="0.01" />
              </label>
              <label>
                Payment date
                <input required type="date" name="date" defaultValue={today} />
              </label>
            </div>
            <footer className="cs2-form-footer">
              <ProductButton type="button" variant="quiet" onClick={() => setDialog(null)}>
                Cancel
              </ProductButton>
              <ProductButton type="submit">Record payment</ProductButton>
            </footer>
          </form>
        </StudioDialog>
      )}
      {(pendingNavigation || historyBlocker.state === 'blocked') && (
        <StudioDialog
          title="Keep your changes?"
          onClose={() => {
            setPendingNavigation(null);
            if (historyBlocker.state === 'blocked') historyBlocker.reset();
          }}
        >
          <div className="cs2-dialog-body">
            <p>You have unsaved work. Save it before leaving, or return to keep editing.</p>
            <footer className="cs2-form-footer">
              <ProductButton
                variant="quiet"
                onClick={() => {
                  setPendingNavigation(null);
                  if (historyBlocker.state === 'blocked') historyBlocker.reset();
                }}
              >
                Keep editing
              </ProductButton>
              <ProductButton
                variant="secondary"
                onClick={() => {
                  setAssignmentStore((items) => ({
                    ...items,
                    [activeSlot.saved.id]: {
                      saved: activeSlot.saved,
                      draft: structuredClone(activeSlot.saved),
                    },
                  }));
                  setProfileDraft(null);
                  if (pendingNavigation)
                    move(
                      pendingNavigation.view,
                      pendingNavigation.learnerId,
                      true,
                      pendingNavigation.assignmentId,
                      pendingNavigation.lessonId,
                    );
                  if (historyBlocker.state === 'blocked') historyBlocker.proceed();
                  setPendingNavigation(null);
                }}
              >
                Discard & leave
              </ProductButton>
              <ProductButton
                onClick={() => {
                  if (saveEdits()) {
                    if (pendingNavigation)
                      move(
                        pendingNavigation.view,
                        pendingNavigation.learnerId,
                        true,
                        pendingNavigation.assignmentId,
                        pendingNavigation.lessonId,
                      );
                    if (historyBlocker.state === 'blocked') historyBlocker.proceed();
                    setPendingNavigation(null);
                  }
                }}
              >
                Save & leave
              </ProductButton>
            </footer>
            {error && (
              <p role="alert" className="cs2-error">
                {error}
              </p>
            )}
          </div>
        </StudioDialog>
      )}
    </div>
  );
}

function ContextContent({
  state,
  children,
  onRetry,
}: {
  state: ContextState;
  children: ReactNode;
  onRetry: () => void;
}) {
  if (state === 'unavailable')
    return (
      <div className="cs2-unavailable">
        <h3>Learner context unavailable</h3>
        <p>The profile could not be loaded. This does not mean the learner has no profile.</p>
        <ProductButton variant="secondary" onClick={onRetry}>
          Retry context
        </ProductButton>
      </div>
    );
  if (state === 'empty')
    return (
      <div className="cs2-empty">
        <p>No learner context recorded yet.</p>
        <p className="cs2-muted">
          You can continue lesson and assignment work without a complete profile.
        </p>
      </div>
    );
  return <>{children}</>;
}

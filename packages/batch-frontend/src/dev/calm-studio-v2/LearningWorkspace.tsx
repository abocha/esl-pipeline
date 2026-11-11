import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { type RefObject, useId, useRef } from 'react';

import { ProductButton } from '../../ui/system/ProductButton';
import './LearningWorkspace.css';

import { type StudioAssignment } from './assignment-model';
import { displayDate, type Learner, type Lesson } from './fixtures';
import {
  type LearningMemory,
  memoryNotes,
  type ProfileData,
  profileFields,
  profileGroups,
} from './learning-data';
import type { ProfileChange } from './profile-updates';

export function LearningWorkspace({
  learner,
  profile,
  draft,
  onDraft,
  onSave,
  onCancel,
  onVersions,
  version,
  contextState,
  onRetry,
  assignments,
  lessons,
  onAssignment,
  onLesson,
  onStartAssignment,
  changes,
  onChanges,
  notice,
  memory,
  onRetryMemory,
  profileOrigin,
  staleDraft,
  onReviewUpdate,
  headingRef,
}: {
  learner: Learner;
  profile: ProfileData;
  draft: ProfileData | null;
  onDraft: (value: ProfileData) => void;
  onSave: () => boolean;
  onCancel: () => void;
  onVersions: () => void;
  version: number;
  contextState: 'ready' | 'empty' | 'unavailable';
  onRetry: () => void;
  assignments: StudioAssignment[];
  lessons: Lesson[];
  onAssignment: (id: string) => void;
  onLesson: (id: string) => void;
  onStartAssignment: () => void;
  changes: ProfileChange[];
  onChanges: () => void;
  notice: string;
  memory: LearningMemory;
  onRetryMemory: () => void;
  profileOrigin: 'tutor_only' | 'evidence_enriched';
  staleDraft: boolean;
  onReviewUpdate: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const profileTitle = useId();
  const memoryTitle = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const firstField = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;
  const notes = memoryNotes[learner.id];
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(profile);
  const sources = assignments.filter(
    (item) => item.source.trim() && (item.unlocked > 1 || item.status === 'transcript'),
  );
  const completed = lessons.filter((item) => item.state === 'Completed');
  const latestMemorySource =
    memory.latest &&
    sources.find(
      (item) =>
        item.id === memory.latest!.assignmentId && item.sourceId === memory.latest!.sourceId,
    );
  const latestMemory = latestMemorySource ? memory.latest : null;
  const upcoming = lessons
    .filter(
      (item) =>
        item.state === 'Scheduled' &&
        new Date(`${item.date}T${item.time}:00+07:00`).getTime() > Date.now(),
    )
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  function beginEdit(value = profile) {
    onDraft(structuredClone(value));
    requestAnimationFrame(() => firstField.current?.focus());
  }

  return (
    <div className={`cs2-learning-workspace${editing ? ' cs2-is-editing' : ''}`}>
      <header className="cs2-page-heading cs2-learning-heading">
        <div>
          <h1 ref={headingRef} tabIndex={-1}>
            Learning
          </h1>
        </div>
        <button className="cs2-text-button" type="button" onClick={onVersions}>
          <History size={15} />
          Profile versions
        </button>
      </header>
      <nav className="cs2-learning-jumps" aria-label="Learning sections">
        <a href="#cs2-learning-memory">Current learning</a>
        <a href="#cs2-learning-profile">
          Learner profile <ArrowRight size={15} />
        </a>
      </nav>
      {upcoming && (
        <div className="cs2-next-teaching">
          <span>
            Next lesson{' '}
            <strong>
              {displayDate(upcoming.date)} · {upcoming.time}
            </strong>
          </span>
          <button type="button" className="cs2-text-button" onClick={() => onLesson(upcoming.id)}>
            View lesson
            <ArrowRight size={14} />
          </button>
        </div>
      )}
      <div className="cs2-learning-composition">
        <section
          id="cs2-learning-memory"
          className="cs2-learning-evidence"
          aria-labelledby={memoryTitle}
        >
          <div className="cs2-evidence-heading">
            <h2 id={memoryTitle}>{latestMemory && notes ? 'Open threads' : 'Recent memory'}</h2>
            {latestMemory && notes && (
              <span className="cs2-thread-count">{notes.threads.length}</span>
            )}
          </div>
          {latestMemory && notes && (
            <div className="cs2-open-threads">
              <dl className="cs2-memory-threads">
                {notes.threads.map((thread) => (
                  <div key={thread.title}>
                    <dt>{thread.title}</dt>
                    <dd>{thread.note}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <section className="cs2-learning-memory" aria-label="Background learner memory">
            <div className="cs2-memory-state">
              <h3>Memory summary</h3>
              <span
                key={memory.status}
                className={`cs2-memory-status cs2-memory-status-${memory.status} cs2-state-enter`}
                role="status"
              >
                {memory.status === 'updating' ? (
                  <>
                    <LoaderCircle className="cs2-processing-spinner" size={14} />
                    Updating
                  </>
                ) : memory.status === 'ready' ? (
                  <>
                    <Check size={14} />
                    Ready snapshot
                  </>
                ) : memory.status === 'failed' ? (
                  'Needs attention'
                ) : (
                  'Waiting for lesson evidence'
                )}
              </span>
            </div>
            {memory.status === 'updating' && (
              <p>
                {memory.initial
                  ? 'Preparing first-lesson learner context…'
                  : 'Updating from confirmed lesson or homework…'}
              </p>
            )}
            {memory.status === 'failed' && (
              <>
                <p>
                  The background update could not finish.
                  {latestMemory ? ' The last ready context is retained.' : ''}
                </p>
                <button type="button" className="cs2-text-button" onClick={onRetryMemory}>
                  <RotateCcw size={14} />
                  Retry background update
                </button>
              </>
            )}
            {latestMemory && <p className="cs2-memory-summary">{latestMemory.summary}</p>}
            {memory.processingIssue && memory.status !== 'failed' && (
              <div className="cs2-memory-processing-issue" role="status">
                <strong>Some newer work needs attention</strong>
                <p>{memory.processingIssue}</p>
                <button
                  type="button"
                  className="cs2-text-button"
                  disabled={memory.status === 'updating'}
                  onClick={onRetryMemory}
                >
                  Retry memory processing
                </button>
              </div>
            )}
            {latestMemory && (
              <details className="cs2-memory-detail">
                <summary>
                  {memory.status === 'updating' || memory.status === 'failed'
                    ? latestMemorySource?.lessonId
                      ? 'Previous lesson transcript'
                      : 'Previous teaching notes'
                    : latestMemorySource?.lessonId
                      ? 'Latest lesson transcript'
                      : 'Latest teaching notes'}{' '}
                  ·{' '}
                  {new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Asia/Ho_Chi_Minh',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(latestMemory.updatedAt))}
                  <ChevronRight size={14} />
                </summary>
                <div>
                  <p>{latestMemorySource!.source}</p>
                </div>
              </details>
            )}
            {latestMemorySource && (
              <button
                className="cs2-text-button cs2-latest-assignment"
                type="button"
                onClick={() => onAssignment(latestMemorySource.id)}
              >
                {latestMemorySource.status === 'draft'
                  ? 'Continue latest assignment'
                  : 'Open latest assignment'}{' '}
                <ArrowRight size={14} />
              </button>
            )}
            {memory.status === 'idle' && (
              <p>
                Lesson notes and homework refresh this context in the background after processing.
              </p>
            )}
          </section>
          {latestMemory && notes && (
            <div className="cs2-memory-sections">
              {(['lessons', 'homework'] as const).map((kind) => (
                <details className="cs2-memory-section" key={kind}>
                  <summary>
                    <span>
                      {kind === 'lessons' ? 'Recent lesson memory' : 'Recent homework memory'}{' '}
                      <small>{notes[kind].length}</small>
                    </span>
                    <ChevronRight size={15} />
                  </summary>
                  <ol className="cs2-memory-entries">
                    {notes[kind].map((entry) => (
                      <li key={entry.title}>
                        <h4>{entry.title}</h4>
                        {entry.generatedAt && (
                          <time className="cs2-memory-entry-date" dateTime={entry.generatedAt}>
                            {displayDate(entry.generatedAt.slice(0, 10))}
                          </time>
                        )}
                        <p>{entry.summary}</p>
                        {assignments.some(
                          (source) =>
                            source.id === entry.assignmentId && source.sourceId === entry.sourceId,
                        ) && (
                          <button
                            type="button"
                            className="cs2-text-button"
                            onClick={() => onAssignment(entry.assignmentId!)}
                          >
                            Open assignment <ArrowRight size={13} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                </details>
              ))}
            </div>
          )}
          {sources.length === 0 && completed.length === 0 ? (
            <div className="cs2-evidence-empty">
              <p>No lesson transcripts or teaching notes yet.</p>
              <button type="button" className="cs2-text-button" onClick={onStartAssignment}>
                Start an assignment
                <ArrowRight size={15} />
              </button>
            </div>
          ) : (
            <details className="cs2-evidence-list">
              <summary>
                Lesson transcripts & notes <ChevronRight size={16} />
              </summary>
              {sources.map((item) => {
                const lesson = lessons.find((row) => row.id === item.lessonId);
                return (
                  <section className="cs2-evidence-source" key={item.id}>
                    <div className="cs2-source-kind">
                      <FileText size={14} />
                      <span>{lesson ? 'Lesson transcript' : 'Teaching notes'}</span>
                      {lesson && <span>{displayDate(lesson.date)}</span>}
                    </div>
                    <h3>
                      {item.content.title === 'Untitled assignment'
                        ? 'Assignment in preparation'
                        : item.content.title}
                    </h3>
                    <p className="cs2-source-excerpt">{item.source}</p>
                    <details className="cs2-source-detail">
                      <summary>
                        {lesson ? 'Transcript & teaching context' : 'Notes & teaching context'}
                        <ChevronRight size={14} />
                      </summary>
                      <div className="cs2-source-document">
                        <span>{lesson ? 'Lesson transcript' : 'Teaching notes'}</span>
                        <p>{item.source}</p>
                        <span>Teaching context for this assignment</span>
                        <p>{item.context}</p>
                      </div>
                    </details>
                    <button
                      type="button"
                      className="cs2-text-button"
                      onClick={() => onAssignment(item.id)}
                    >
                      {item.status === 'draft' ? 'Continue assignment' : 'Open assignment'}
                      <ArrowRight size={14} />
                    </button>
                  </section>
                );
              })}
              {completed
                .filter((item) => !sources.some((source) => source.lessonId === item.id))
                .map((item) => (
                  <section className="cs2-evidence-source" key={item.id}>
                    <div className="cs2-source-kind">
                      <BookOpen size={14} />
                      <span>Completed lesson</span>
                      <span>{displayDate(item.date)}</span>
                    </div>
                    <p>{item.notes || 'No teaching notes recorded.'}</p>
                    <button
                      type="button"
                      className="cs2-text-button"
                      onClick={() => onLesson(item.id)}
                    >
                      View lesson
                      <ArrowRight size={14} />
                    </button>
                  </section>
                ))}
            </details>
          )}
        </section>
        <section
          id="cs2-learning-profile"
          className="cs2-learner-profile"
          aria-labelledby={profileTitle}
        >
          <header className="cs2-profile-heading">
            <div>
              <h2 id={profileTitle} ref={titleRef} tabIndex={-1}>
                Learning profile
              </h2>
              <span className="cs2-profile-provenance">
                {contextState === 'ready'
                  ? `${profileOrigin === 'tutor_only' ? 'Tutor notes' : memory.initial ? 'Initially enriched automatically' : 'Established profile'} · Version ${version}`
                  : 'Established learner context'}
              </span>
            </div>
            {contextState === 'ready' && !editing && (
              <ProductButton variant="secondary" icon={<Pencil />} onClick={() => beginEdit()}>
                Edit profile
              </ProductButton>
            )}
          </header>
          {contextState === 'ready' && (
            <div className="cs2-profile-update-policy">
              <span>
                {changes.length ? (
                  <>
                    <Check size={15} /> Profile updated ·{' '}
                    {changes.filter((change) => change.status === 'applied').length} changes kept
                  </>
                ) : profileOrigin === 'tutor_only' ? (
                  'Learning from lesson evidence in the background.'
                ) : (
                  'No recent automatic changes.'
                )}
              </span>
              {changes.length > 0 && (
                <button
                  type="button"
                  className="cs2-text-button cs2-profile-review-action"
                  onClick={onChanges}
                >
                  View changes <ArrowRight size={14} />
                </button>
              )}
            </div>
          )}
          {contextState === 'unavailable' ? (
            <div className="cs2-unavailable">
              <h3>Learner context unavailable</h3>
              <p>
                The profile could not be loaded. Saved lesson transcripts and notes remain available
                separately.
              </p>
              <ProductButton variant="secondary" onClick={onRetry}>
                Retry context
              </ProductButton>
            </div>
          ) : contextState === 'empty' && !editing ? (
            <div className="cs2-profile-empty">
              <BookOpen size={26} />
              <h3>Start with what matters to {learner.name.split(' ')[0]}</h3>
              <p>
                Goals, useful teaching context and personal interests can be added as you learn
                them.
              </p>
              <ProductButton
                variant="secondary"
                icon={<Plus />}
                onClick={() =>
                  beginEdit(
                    Object.fromEntries(
                      profileFields.map((field) => [field.key, '']),
                    ) as ProfileData,
                  )
                }
              >
                Add learner context
              </ProductButton>
            </div>
          ) : (
            <div key={editing ? 'editing' : 'reading'} className="cs2-profile-body cs2-state-enter">
              {editing ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (onSave()) requestAnimationFrame(() => titleRef.current?.focus());
                  }}
                >
                  {staleDraft && (
                    <div className="cs2-background-profile-notice" role="status">
                      <strong>Profile updated in the background</strong>
                      <p>
                        Your open draft has been kept. Compare the new learner context before
                        saving.
                      </p>
                      <ProductButton type="button" variant="secondary" onClick={onReviewUpdate}>
                        Review background update
                      </ProductButton>
                    </div>
                  )}
                  {profileFields.map((field, index) => (
                    <label
                      className={`cs2-learning-field ${field.key === 'goal' ? 'cs2-learning-goal-field' : ''}`}
                      key={field.key}
                    >
                      <span>{field.label}</span>
                      <textarea
                        aria-label={field.label}
                        ref={index === 0 ? firstField : undefined}
                        rows={
                          field.key === 'level'
                            ? 1
                            : Math.min(
                                9,
                                Math.max(3, (draft?.[field.key] ?? '').split('\n').length + 1),
                              )
                        }
                        value={draft?.[field.key] ?? ''}
                        placeholder={field.prompt}
                        onChange={(event) =>
                          onDraft({ ...draft!, [field.key]: event.target.value })
                        }
                      />
                    </label>
                  ))}
                  <footer className="cs2-profile-savebar">
                    <span className={dirty ? 'cs2-draft-state' : 'cs2-muted'}>
                      {dirty ? 'Unsaved profile changes' : 'No changes yet'}
                    </span>
                    <div className="cs2-row-actions">
                      <ProductButton type="button" variant="quiet" onClick={onCancel}>
                        Cancel editing
                      </ProductButton>
                      <ProductButton type="submit" disabled={!dirty || staleDraft}>
                        Save profile
                      </ProductButton>
                    </div>
                  </footer>
                </form>
              ) : (
                <>
                  <div className="cs2-profile-goal">
                    <div className="cs2-profile-goal-heading">
                      <h3>Learning goals</h3>
                      <span>{profile.level || 'Level not recorded'}</span>
                    </div>
                    <p>{profile.goal.split('\n')[0] || 'No learning goal recorded.'}</p>
                    {profile.goal.includes('\n') && (
                      <ul className="cs2-fact-list">
                        {profile.goal
                          .split('\n')
                          .slice(1)
                          .filter(Boolean)
                          .map((line, index) => (
                            <li key={index}>{line}</li>
                          ))}
                      </ul>
                    )}
                  </div>
                  <div className="cs2-profile-groups">
                    {profileGroups.map((group) => (
                      <details className="cs2-profile-group" key={group.title}>
                        <summary>
                          <span>{group.title}</span>
                          <ChevronRight size={15} />
                        </summary>
                        <dl className="cs2-learner-facts">
                          {group.keys.map((key) => (
                            <div key={key}>
                              <dt>{profileFields.find((field) => field.key === key)!.label}</dt>
                              <dd>
                                {profile[key] ? (
                                  <ul className="cs2-fact-list">
                                    {profile[key]
                                      .split('\n')
                                      .filter(Boolean)
                                      .map((line, itemIndex) => (
                                        <li key={itemIndex}>{line}</li>
                                      ))}
                                  </ul>
                                ) : (
                                  'Not recorded yet'
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    ))}
                  </div>
                  {notice && (
                    <p className="cs2-profile-save-confirmation" role="status">
                      <Check size={14} />
                      {notice}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

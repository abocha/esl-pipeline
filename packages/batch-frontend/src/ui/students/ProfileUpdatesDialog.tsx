import { BookOpen, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProfileMaintenanceChangeDto } from '@esl-pipeline/contracts';

import { useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import {
  listProfileChanges,
  ProfileRevisionConflictApiError,
  undoProfileChange,
} from '../../utils/api';
import { formatTutorTime } from '../../utils/tutor-time';
import { LoadingPlaceholder } from '../system/LoadingPlaceholder';
import { useDialogBackdropDismiss } from '../system/useDialogBackdropDismiss';

import './ProfileUpdatesDialog.css';

const fieldLabels = {
  communicationContexts: 'Communication contexts',
  interestsAndUsefulThemes: 'Interests & useful themes',
  studyPreferences: 'Study preferences',
  stableStrengths: 'Stable strengths',
} as const;

export function ProfileUpdatesDialog({
  studentId,
  onClose,
  onProfileChanged,
}: {
  studentId: string;
  onClose: () => void;
  onProfileChanged: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const mutationPending = useRef(false);
  const timezone = useWorkspaceTimezone();
  const [items, setItems] = useState<ProfileMaintenanceChangeDto[]>([]);
  const [activeHead, setActiveHead] = useState<string | null | undefined>(undefined);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const evidenceItem = items.find((item) => item.id === evidenceId);
  const dismiss = () => {
    if (!mutationPending.current) onClose();
  };
  const backdropDismiss = useDialogBackdropDismiss(dismiss);
  const load = useCallback(
    async (nextCursor?: string) => {
      const request = generation.current;
      setLoading(true);
      try {
        const result = await listProfileChanges(studentId, nextCursor);
        if (request !== generation.current) return;
        setItems((current) => {
          const byId = new Map((nextCursor ? current : []).map((item) => [item.id, item]));
          for (const item of result.items) byId.set(item.id, item);
          return [...byId.values()];
        });
        setActiveHead(result.activeRevisionId);
        setCursor(result.nextCursor);
      } catch {
        if (request === generation.current) setError('Profile updates unavailable.');
      } finally {
        if (request === generation.current) setLoading(false);
      }
    },
    [studentId],
  );

  useEffect(() => {
    generation.current += 1;
    setItems([]);
    setActiveHead(undefined);
    setError(null);
    setBusyId(null);
    setEvidenceId(null);
    mutationPending.current = false;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const host = dialog.current;
    host?.showModal();
    void load();
    return () => {
      generation.current += 1;
      host?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [load]);

  const undo = async (item: ProfileMaintenanceChangeDto) => {
    if (activeHead === undefined || mutationPending.current) return;
    const request = generation.current;
    mutationPending.current = true;
    setBusyId(item.id);
    setError(null);
    try {
      await undoProfileChange(studentId, item.id, { expectedActiveRevisionId: activeHead });
      if (request !== generation.current) return;
      setActiveHead(undefined);
      await load();
      if (request !== generation.current) return;
      await onProfileChanged();
    } catch (cause) {
      if (request !== generation.current) return;
      setError(
        cause instanceof ProfileRevisionConflictApiError
          ? cause.code === 'profile_change_conflict'
            ? 'This field changed after the update. Undo is unavailable.'
            : 'The profile changed. Review the latest updates before trying again.'
          : 'Undo did not complete. Try again.',
      );
      setActiveHead(undefined);
      await load();
    } finally {
      if (request === generation.current) {
        mutationPending.current = false;
        setBusyId(null);
      }
    }
  };

  return (
    <dialog
      ref={dialog}
      className="profile-updates-dialog"
      aria-labelledby="profile-updates-title"
      {...backdropDismiss}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <header>
        <h2 id="profile-updates-title">{evidenceItem ? 'Lesson evidence' : 'Profile updates'}</h2>
        <button
          type="button"
          aria-label="Close profile updates"
          disabled={Boolean(busyId)}
          onClick={dismiss}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      {evidenceItem ? (
        <section className="profile-updates-evidence" aria-label="Lesson evidence">
          <button type="button" onClick={() => setEvidenceId(null)}>
            Back to updates
          </button>
          <p>{evidenceItem.addedValue}</p>
          {evidenceItem.evidence.length ? (
            evidenceItem.evidence.map((source) => (
              <article key={source.lessonMemoryId}>
                <h3>
                  {source.lessonStartedAt
                    ? formatTutorTime(source.lessonStartedAt, timezone)
                    : 'Retained lesson evidence'}
                </h3>
                {source.facts.map((fact, index) => (
                  <section key={`${source.lessonMemoryId}-${index}`}>
                    {fact.fact !== evidenceItem.addedValue && <p>{fact.fact}</p>}
                    {fact.evidence.map((quote, quoteIndex) => (
                      <figure key={`${index}-${quoteIndex}`}>
                        <blockquote>{quote.quote}</blockquote>
                        <figcaption>
                          {quote.speakerRole === 'student'
                            ? 'Student'
                            : quote.speakerRole === 'teacher'
                              ? 'Tutor'
                              : 'Speaker not recorded'}
                        </figcaption>
                      </figure>
                    ))}
                  </section>
                ))}
              </article>
            ))
          ) : (
            <p>Evidence unavailable for this retained update.</p>
          )}
        </section>
      ) : (
        <>
          {error ? <p role="alert">{error}</p> : null}
          {loading && !items.length ? <LoadingPlaceholder label="Loading profile updates" /> : null}
          {!loading && !error && !items.length ? <p>No automatic profile updates yet.</p> : null}
          <ul className="profile-updates-list">
            {items.map((item) => (
              <li key={item.id}>
                <div className="profile-updates-item-heading">
                  <strong>{fieldLabels[item.field]}</strong>
                  <span className={`profile-updates-tag profile-updates-tag--${item.status}`}>
                    {item.status === 'undone' ? 'Undone' : 'New'}
                  </span>
                  <time dateTime={item.appliedAt}>{formatTutorTime(item.appliedAt, timezone)}</time>
                </div>
                <p className="profile-updates-fact">{item.addedValue}</p>
                <div className="profile-updates-values">
                  <section aria-label="Before">
                    <h3>Before</h3>
                    {item.beforeValue.length ? (
                      <ul>
                        {item.beforeValue.map((value) => (
                          <li key={value}>{value}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>None recorded</p>
                    )}
                  </section>
                  <section aria-label={item.status === 'applied' ? 'Now' : 'After update'}>
                    <h3>{item.status === 'applied' ? 'Now' : 'After update'}</h3>
                    <ul>
                      {item.afterValue.map((value) => (
                        <li key={value}>{value}</li>
                      ))}
                    </ul>
                  </section>
                </div>
                <div className="profile-updates-actions">
                  <button
                    type="button"
                    onClick={() => setEvidenceId(item.id)}
                    aria-label={`View lesson evidence for ${item.addedValue}`}
                    title="View lesson evidence"
                  >
                    <BookOpen size={18} aria-hidden="true" />
                  </button>
                  {item.status !== 'undone' ? (
                    <button
                      type="button"
                      aria-label={`Undo ${item.addedValue}`}
                      title={
                        item.canUndo
                          ? 'Undo this addition'
                          : 'Undo unavailable after later field changes'
                      }
                      disabled={
                        !item.canUndo || activeHead === undefined || Boolean(busyId) || loading
                      }
                      onClick={() => void undo(item)}
                    >
                      <Undo2 size={18} aria-hidden="true" />
                      {busyId === item.id ? 'Undoing…' : 'Undo'}
                    </button>
                  ) : null}
                  {item.status === 'blocked' ? (
                    <span>Undo unavailable after later field changes</span>
                  ) : null}
                  {item.reconsiderationAvailable ? <span>Newer evidence available</span> : null}
                </div>
              </li>
            ))}
          </ul>
          {cursor ? (
            <button
              type="button"
              disabled={loading || Boolean(busyId)}
              onClick={() => {
                setError(null);
                void load(cursor);
              }}
            >
              Load older updates
            </button>
          ) : null}
          {error && !cursor ? (
            <button
              type="button"
              disabled={loading || Boolean(busyId)}
              onClick={() => {
                setError(null);
                void load();
              }}
            >
              Retry updates
            </button>
          ) : null}
        </>
      )}
    </dialog>
  );
}

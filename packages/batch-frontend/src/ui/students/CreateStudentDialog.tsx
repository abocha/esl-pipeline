import { Plus } from 'lucide-react';
import { type Dispatch, type SetStateAction, useEffect, useId, useRef } from 'react';

import { StudentDialog } from './StudentDialog';
import { type CreateStudentFormState } from './StudentProfileUi.logic';

export interface CreateStudentDialogProps {
  isOpen: boolean;

  isBusy: boolean;

  error: string | null;

  success: string | null;

  createStudentForm: CreateStudentFormState;

  onToggleOpen: () => void;

  onCancel: () => void;

  onSubmit: () => void;

  setCreateStudentForm: Dispatch<SetStateAction<CreateStudentFormState>>;
}

export function CreateStudentDialog({
  isOpen,

  isBusy,

  error,

  success,

  createStudentForm,

  onToggleOpen,

  onCancel,

  onSubmit,

  setCreateStudentForm,
}: CreateStudentDialogProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);

  const toggleRef = useRef<HTMLButtonElement>(null);

  const wasOpen = useRef(false);

  const errorId = useId();

  useEffect(() => {
    if (isOpen) nameInputRef.current?.focus();
    else if (wasOpen.current) toggleRef.current?.focus();

    wasOpen.current = isOpen;
  }, [isOpen]);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="roster-add"
        aria-label="Add student"
        title="Add student"
        disabled={isBusy}
        onClick={onToggleOpen}
      >
        <Plus size={19} aria-hidden="true" />
      </button>
      {success && (
        <span role="status" className="student-workspace-sr-only">
          {success}
        </span>
      )}
      <StudentDialog open={isOpen} titleId="create-student-title" onCancel={onCancel}>
        <h2 id="create-student-title">Add student</h2>
        <form
          className="student-workspace-create"
          onSubmit={(event) => {
            event.preventDefault();

            if (!isBusy) onSubmit();
          }}
        >
          <label className="workspace-field">
            Student Name
            <input
              ref={nameInputRef}
              aria-label="Student Name"
              aria-invalid={Boolean(error && !createStudentForm.student.trim())}
              aria-describedby={error ? errorId : undefined}
              value={createStudentForm.student}
              onChange={(event) =>
                setCreateStudentForm((current) => ({
                  ...current,

                  student: event.target.value,
                }))
              }
              placeholder="e.g. Alex"
            />
          </label>

          <details className="workspace-starter-profile">
            <summary className="workspace-starter-summary">
              <span>
                <span className="workspace-starter-title">Starter profile</span>
                <span className="workspace-starter-description">
                  Optional notes for the first learning profile
                </span>
              </span>
              <span className="workspace-starter-badge">Optional</span>
            </summary>
            <div className="workspace-starter-groups">
              <fieldset className="workspace-starter-group">
                <legend>Learning direction</legend>
                <label className="workspace-field">
                  Current Level
                  <input
                    aria-label="Current Level"
                    value={createStudentForm.overallLevel}
                    onChange={(event) =>
                      setCreateStudentForm((current) => ({
                        ...current,

                        overallLevel: event.target.value,
                      }))
                    }
                    placeholder="A2, B1, mixed"
                  />
                </label>

                <label className="workspace-field workspace-field-span-2">
                  Primary Goals
                  <textarea
                    aria-label="Primary Goals"
                    value={createStudentForm.primaryGoals}
                    onChange={(event) =>
                      setCreateStudentForm((current) => ({
                        ...current,

                        primaryGoals: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="Work calls, travel, exams"
                  />
                </label>
              </fieldset>

              <fieldset className="workspace-starter-group">
                <legend>Context</legend>
                <label className="workspace-field workspace-field-span-2">
                  Communication Contexts
                  <textarea
                    aria-label="Communication Contexts"
                    value={createStudentForm.communicationContexts}
                    onChange={(event) =>
                      setCreateStudentForm((current) => ({
                        ...current,

                        communicationContexts: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="Meetings, clients, daily life"
                  />
                </label>

                <label className="workspace-field workspace-field-span-2">
                  Interests & Useful Themes
                  <textarea
                    aria-label="Interests & Useful Themes"
                    value={createStudentForm.interestsAndUsefulThemes}
                    onChange={(event) =>
                      setCreateStudentForm((current) => ({
                        ...current,

                        interestsAndUsefulThemes: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="Topics that make practice stick"
                  />
                </label>
              </fieldset>

              <fieldset className="workspace-starter-group">
                <legend>Teaching notes</legend>
                <label className="workspace-field workspace-field-span-2">
                  Stable Strengths
                  <textarea
                    aria-label="Stable Strengths"
                    value={createStudentForm.stableStrengths}
                    onChange={(event) =>
                      setCreateStudentForm((current) => ({
                        ...current,

                        stableStrengths: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="What already works"
                  />
                </label>

                <label className="workspace-field workspace-field-span-2">
                  Persistent Challenges
                  <textarea
                    aria-label="Persistent Challenges"
                    value={createStudentForm.persistentChallenges}
                    onChange={(event) =>
                      setCreateStudentForm((current) => ({
                        ...current,

                        persistentChallenges: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="Recurring friction"
                  />
                </label>

                <label className="workspace-field workspace-field-span-2">
                  Study Preferences
                  <textarea
                    aria-label="Study Preferences"
                    value={createStudentForm.studyPreferences}
                    onChange={(event) =>
                      setCreateStudentForm((current) => ({
                        ...current,

                        studyPreferences: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="Correction style, homework habits"
                  />
                </label>

                <label className="workspace-field workspace-field-span-2">
                  Durable Constraints
                  <textarea
                    aria-label="Durable Constraints"
                    value={createStudentForm.durableConstraints}
                    onChange={(event) =>
                      setCreateStudentForm((current) => ({
                        ...current,

                        durableConstraints: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="Time, device, schedule"
                  />
                </label>

                <label className="workspace-field workspace-field-span-2">
                  Teacher Notes
                  <textarea
                    aria-label="Teacher Notes"
                    value={createStudentForm.teacherNotes}
                    onChange={(event) =>
                      setCreateStudentForm((current) => ({
                        ...current,

                        teacherNotes: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="Anything else to preserve"
                  />
                </label>
              </fieldset>
            </div>
          </details>

          <div className="workspace-create-actions">
            <button type="submit" className="workspace-primary-btn" disabled={isBusy}>
              {isBusy ? 'Adding…' : 'Add student'}
            </button>
            <button
              type="button"
              className="workspace-secondary-btn"
              onClick={onCancel}
              disabled={isBusy}
            >
              Cancel
            </button>
          </div>

          {error ? (
            <p id={errorId} className="workspace-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </StudentDialog>
    </>
  );
}

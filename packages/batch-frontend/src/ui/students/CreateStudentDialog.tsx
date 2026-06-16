import type { Dispatch, SetStateAction } from 'react';

import { type CreateStudentFormState } from './StudentWorkspace.logic';

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
  return (
    <>
      <header>
        <div className="workspace-inline workspace-header-row">
          <h2>Create student</h2>
          <button type="button" className="workspace-secondary-btn" onClick={onToggleOpen}>
            {isOpen ? 'Close Create Form' : 'Create Student'}
          </button>
        </div>
        <p>
          Create the learner record. Optional notes below become the first version of this student
          page.
        </p>
      </header>

      {success ? <p className="workspace-success">{success}</p> : null}

      {isOpen ? (
        <div className="workspace-create-panel">
          <label className="workspace-field">
            Student Name
            <input
              aria-label="Student Name"
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
            <summary>Starter profile (optional)</summary>
            <p className="workspace-muted">
              Add only what you know now. Every field is optional and can be refined later from the
              student Learning page.
            </p>
            <div className="workspace-grid">
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
                  placeholder="e.g. A2"
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
                  rows={3}
                  placeholder="What is this student trying to achieve?"
                />
              </label>

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
                  placeholder="Work, life context, communication situations"
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
                  placeholder="Topics or hobbies that help personalize homework"
                />
              </label>

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
                  placeholder="Strengths that should shape teaching choices"
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
                  placeholder="Recurring issues, caution areas, or repair targets"
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
                  placeholder="Preferences, habits, correction style, or assignment requests"
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
                  placeholder="Time, device, confidence, context, or access constraints"
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
                  placeholder="Anything the first profile version should preserve"
                />
              </label>
            </div>
          </details>

          <div className="workspace-inline">
            <button
              type="button"
              className="workspace-primary-btn"
              onClick={onSubmit}
              disabled={isBusy}
            >
              {isBusy ? 'Creating...' : 'Create Student'}
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

          {error ? <p className="workspace-error">{error}</p> : null}
        </div>
      ) : null}
    </>
  );
}

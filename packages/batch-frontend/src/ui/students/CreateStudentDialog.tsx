import type { Dispatch, SetStateAction } from 'react';

import type { ProfileContentOption } from '../../utils/api';
import { type CreateStudentFormState } from './StudentWorkspace.logic';

export interface CreateStudentDialogProps {
  isOpen: boolean;
  isBusy: boolean;
  error: string | null;
  success: string | null;
  profileOptions: ProfileContentOption[];
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
  profileOptions,
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
        <p>Create a student record and optionally seed the first learner profile.</p>
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

          <label className="workspace-field">
            Initial Profile (optional)
            <select
              aria-label="Initial Profile"
              value={createStudentForm.profileId}
              onChange={(event) =>
                setCreateStudentForm((current) => ({
                  ...current,
                  profileId: event.target.value,
                }))
              }
            >
              <option value="">No learner profile selected</option>
              {profileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label} ({profile.id})
                </option>
              ))}
            </select>
          </label>

          <details className="workspace-advanced">
            <summary>Starter profile (optional)</summary>
            <p className="workspace-muted">
              Use this when you want the system to create the initial learner profile from teacher
              input. If you fill this in, it takes precedence over the existing-profile picker.
            </p>
            <div className="workspace-grid">
              <label className="workspace-field">
                Starter Level
                <input
                  aria-label="Starter Level"
                  value={createStudentForm.starterLevel}
                  onChange={(event) =>
                    setCreateStudentForm((current) => ({
                      ...current,
                      starterLevel: event.target.value,
                    }))
                  }
                  placeholder="e.g. A2"
                />
              </label>

              <label className="workspace-field workspace-field-span-2">
                Starter Goals
                <textarea
                  aria-label="Starter Goals"
                  value={createStudentForm.starterGoals}
                  onChange={(event) =>
                    setCreateStudentForm((current) => ({
                      ...current,
                      starterGoals: event.target.value,
                    }))
                  }
                  rows={3}
                  placeholder="What is this student trying to achieve?"
                />
              </label>

              <label className="workspace-field workspace-field-span-2">
                Profession Or Context
                <textarea
                  aria-label="Profession Or Context"
                  value={createStudentForm.starterProfessionOrContext}
                  onChange={(event) =>
                    setCreateStudentForm((current) => ({
                      ...current,
                      starterProfessionOrContext: event.target.value,
                    }))
                  }
                  rows={2}
                  placeholder="Work, life context, communication situations"
                />
              </label>

              <label className="workspace-field workspace-field-span-2">
                Interests
                <textarea
                  aria-label="Interests"
                  value={createStudentForm.starterInterests}
                  onChange={(event) =>
                    setCreateStudentForm((current) => ({
                      ...current,
                      starterInterests: event.target.value,
                    }))
                  }
                  rows={2}
                  placeholder="Topics or hobbies that help personalize homework"
                />
              </label>

              <label className="workspace-field workspace-field-span-2">
                Long-Running Challenges
                <textarea
                  aria-label="Long-Running Challenges"
                  value={createStudentForm.starterLongRunningChallenges}
                  onChange={(event) =>
                    setCreateStudentForm((current) => ({
                      ...current,
                      starterLongRunningChallenges: event.target.value,
                    }))
                  }
                  rows={2}
                  placeholder="Persistent issues, constraints, or caution areas"
                />
              </label>

              <label className="workspace-field workspace-field-span-2">
                Study Preferences Or Constraints
                <textarea
                  aria-label="Study Preferences Or Constraints"
                  value={createStudentForm.starterStudyPreferencesOrConstraints}
                  onChange={(event) =>
                    setCreateStudentForm((current) => ({
                      ...current,
                      starterStudyPreferencesOrConstraints: event.target.value,
                    }))
                  }
                  rows={2}
                  placeholder="Preferences, habits, formatting requests, constraints"
                />
              </label>

              <label className="workspace-field workspace-field-span-2">
                Starter Teacher Notes
                <textarea
                  aria-label="Starter Teacher Notes"
                  value={createStudentForm.starterTeacherNotes}
                  onChange={(event) =>
                    setCreateStudentForm((current) => ({
                      ...current,
                      starterTeacherNotes: event.target.value,
                    }))
                  }
                  rows={2}
                  placeholder="Anything the first profile draft should preserve"
                />
              </label>
            </div>
          </details>

          <details className="workspace-advanced">
            <summary>Advanced fields</summary>
            <div className="workspace-grid">
              <label className="workspace-field">
                Color Preset
                <input
                  aria-label="Color Preset"
                  value={createStudentForm.colorPreset}
                  onChange={(event) =>
                    setCreateStudentForm((current) => ({
                      ...current,
                      colorPreset: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="workspace-field">
                Accent Preference
                <input
                  aria-label="Accent Preference"
                  value={createStudentForm.accentPreference}
                  onChange={(event) =>
                    setCreateStudentForm((current) => ({
                      ...current,
                      accentPreference: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="workspace-field">
                Manifest Preset
                <input
                  aria-label="Manifest Preset"
                  value={createStudentForm.manifestPreset}
                  onChange={(event) =>
                    setCreateStudentForm((current) => ({
                      ...current,
                      manifestPreset: event.target.value,
                    }))
                  }
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

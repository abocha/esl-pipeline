import React, { useEffect, useState } from 'react';

import type { PromptOptionsResponse, PromptPackageResponse } from '../../utils/api';
import { createPromptPackage, fetchPromptOptions } from '../../utils/api';
import { WizardStep } from './WizardStep';

interface Step3AddNotesProps {
  recordingId: string | null;
  notes: string;
  setNotes: (value: string) => void;
  templateId: string;
  setTemplateId: (value: string) => void;
  profileId: string;
  setProfileId: (value: string) => void;
  promptPackageId: string | null;
  onPromptReady: (promptPackage: PromptPackageResponse) => void;
  onNext: () => void;
  onBack: () => void;
}

export const Step3AddNotes: React.FC<Step3AddNotesProps> = ({
  recordingId,
  notes,
  setNotes,
  templateId,
  setTemplateId,
  profileId,
  setProfileId,
  promptPackageId,
  onPromptReady,
  onNext,
  onBack,
}) => {
  const [promptOptions, setPromptOptions] = useState<PromptOptionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadPromptOptions = async () => {
      try {
        const response = await fetchPromptOptions();
        if (!active) return;
        setPromptOptions(response);
        const templateFallback = response.defaults.templateId ?? response.templates?.[0]?.id ?? '';
        const profileFallback = response.defaults.profileId ?? response.profiles?.[0]?.id ?? '';
        if (!templateId) {
          setTemplateId(templateFallback);
        }
        if (!profileId) {
          setProfileId(profileFallback);
        }
      } catch (loadError) {
        if (!active) return;
        const message = loadError instanceof Error ? loadError.message : 'Unable to load options';
        setError(message);
      }
    };

    void loadPromptOptions();

    return () => {
      active = false;
    };
  }, [setTemplateId, setProfileId, templateId, profileId]);

  const handleContinue = async () => {
    if (!recordingId) {
      setError('Upload a recording first.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await createPromptPackage(recordingId, {
        notes: notes.trim() || undefined,
        templateId: templateId || undefined,
        profileId: profileId || undefined,
      });
      onPromptReady(response);
      onNext();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Unable to create prompt';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <WizardStep
      title="Add notes"
      subtitle="Provide any tutor notes and choose a prompt template before drafting."
      onBack={onBack}
      onNext={handleContinue}
      nextLabel="Continue to draft"
      isNextDisabled={!recordingId}
      isBusy={loading}
    >
      <div className="notes-layout">
        <div className="notes-panel">
          <h3>Notes</h3>
          <textarea
            rows={10}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Add guidance, corrections, or focus areas..."
          />
        </div>
        <div className="notes-panel">
          <h3>Prompt settings</h3>
          {promptOptions ? (
            <>
              <label>
                Template
                <select
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  {promptOptions.templates.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Profile
                <select
                  value={profileId}
                  onChange={(event) => setProfileId(event.target.value)}
                >
                  {promptOptions.profiles.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <p className="muted">Loading prompt options...</p>
          )}
          <div className="notes-pill">
            {promptPackageId ? `Prompt package ready: ${promptPackageId}` : 'No prompt package yet.'}
          </div>
        </div>
      </div>
      {error ? <p className="error-text">{error}</p> : null}

      <style>{`
        .notes-layout {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: var(--space-4);
        }

        .notes-panel {
          background: var(--bg-secondary);
          border-radius: var(--radius-xl);
          padding: var(--space-4);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .notes-panel h3 {
          margin: 0;
        }

        .notes-panel textarea {
          width: 100%;
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          padding: var(--space-3);
          min-height: 200px;
          background: var(--bg-primary);
        }

        .notes-panel label {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .notes-panel select {
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          background: var(--bg-primary);
        }

        .notes-pill {
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-full);
          background: rgba(14, 165, 233, 0.1);
          color: var(--color-info-600);
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .muted {
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }
      `}</style>
    </WizardStep>
  );
};

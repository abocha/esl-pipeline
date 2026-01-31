import React, { useEffect, useMemo, useRef, useState } from 'react';
import copy from 'copy-to-clipboard';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useStudentSelection } from '../../context/StudentSelectionContext';
import type { PromptOptionsResponse, PromptPackageResponse } from '../../utils/api';
import { createPromptPackage, fetchPromptOptions, fetchPromptPackage } from '../../utils/api';
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
  autoSuggestEnabled: boolean;
  onAutomationChange: (updates: { autoSuggestPrompts?: boolean }) => void;
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
  autoSuggestEnabled,
  onAutomationChange,
  onPromptReady,
  onNext,
  onBack,
}) => {
  const { selectedStudent } = useStudentSelection();
  const { logLedgerEntries } = useJobMonitor();
  const [promptOptions, setPromptOptions] = useState<PromptOptionsResponse | null>(null);
  const [promptText, setPromptText] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const lastPromptInputsRef = useRef<{ notes: string; templateId: string; profileId: string } | null>(
    null,
  );
  const autoSuggestAppliedRef = useRef(false);

  const normalizedNotes = notes.trim();
  const isPromptStale =
    Boolean(promptPackageId) &&
    Boolean(lastPromptInputsRef.current) &&
    (lastPromptInputsRef.current!.notes !== normalizedNotes ||
      lastPromptInputsRef.current!.templateId !== templateId ||
      lastPromptInputsRef.current!.profileId !== profileId);

  const suggestions = useMemo(() => {
    if (!promptOptions) {
      return {
        suggestedTemplateId: '',
        suggestedProfileId: '',
      };
    }
    const suggestedTemplateId =
      promptOptions.defaults.templateId ?? promptOptions.templates?.[0]?.id ?? '';
    const studentProfile =
      selectedStudent?.profileId &&
        promptOptions.profiles.some((option) => option.id === selectedStudent.profileId)
        ? selectedStudent.profileId
        : '';
    const suggestedProfileId =
      studentProfile || promptOptions.defaults.profileId || promptOptions.profiles?.[0]?.id || '';
    return { suggestedTemplateId, suggestedProfileId };
  }, [promptOptions, selectedStudent?.profileId]);

  useEffect(() => {
    let active = true;
    const loadPromptOptions = async () => {
      try {
        const response = await fetchPromptOptions();
        if (!active) return;
        setPromptOptions(response);
        const templateFallback =
          response.defaults.templateId ?? response.templates?.[0]?.id ?? '';
        const profileFallback =
          response.defaults.profileId ?? response.profiles?.[0]?.id ?? '';
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

  useEffect(() => {
    if (!autoSuggestEnabled) {
      autoSuggestAppliedRef.current = false;
      return;
    }
    if (!promptOptions) return;
    if (autoSuggestAppliedRef.current) return;
    let applied = false;
    if (!templateId && suggestions.suggestedTemplateId) {
      setTemplateId(suggestions.suggestedTemplateId);
      applied = true;
    }
    if (!profileId && suggestions.suggestedProfileId) {
      setProfileId(suggestions.suggestedProfileId);
      applied = true;
    }
    if (applied) {
      autoSuggestAppliedRef.current = true;
      logLedgerEntries([
        {
          type: 'automation_prompt_suggestion_applied',
          severity: 'info',
          objectType: 'job',
          objectId: recordingId ?? 'unassigned',
          message: 'Applied automated prompt recommendations.',
          source: 'session',
        },
      ]);
    }
  }, [
    autoSuggestEnabled,
    logLedgerEntries,
    promptOptions,
    recordingId,
    profileId,
    suggestions.suggestedProfileId,
    suggestions.suggestedTemplateId,
    setProfileId,
    setTemplateId,
    templateId,
  ]);

  useEffect(() => {
    if (!promptPackageId) {
      setPromptText('');
      lastPromptInputsRef.current = null;
      setPromptLoading(false);
      return;
    }
    if (promptText.trim()) return;
    let active = true;
    const loadPrompt = async () => {
      setPromptLoading(true);
      setError(null);
      try {
        const response = await fetchPromptPackage(promptPackageId);
        if (!active) return;
        setPromptText(response.text ?? '');
        lastPromptInputsRef.current = { notes: normalizedNotes, templateId, profileId };
      } catch (loadError) {
        if (!active) return;
        const message = loadError instanceof Error ? loadError.message : 'Unable to load prompt';
        setError(message);
      } finally {
        if (active) {
          setPromptLoading(false);
        }
      }
    };
    void loadPrompt();
    return () => {
      active = false;
    };
  }, [promptPackageId, promptText, normalizedNotes, templateId, profileId]);

  useEffect(() => {
    setCopyStatus('idle');
  }, [promptText]);

  const handleGeneratePrompt = async () => {
    if (!recordingId) {
      setError('Upload a recording first.');
      return;
    }
    if (!templateId || !profileId) {
      setError('Select a prompt template and profile first.');
      return;
    }

    setPromptLoading(true);
    setError(null);
    try {
      const response = await createPromptPackage(recordingId, {
        notes: normalizedNotes || undefined,
        templateId: templateId || undefined,
        profileId: profileId || undefined,
      });
      onPromptReady(response);
      setPromptText(response.text ?? '');
      lastPromptInputsRef.current = { notes: normalizedNotes, templateId, profileId };
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Unable to create prompt';
      setError(message);
    } finally {
      setPromptLoading(false);
    }
  };

  const handleContinue = () => {
    if (!promptPackageId) {
      setError('Generate a prompt first.');
      return;
    }
    if (isPromptStale) {
      setError('Prompt is out of date. Regenerate before continuing.');
      return;
    }
    onNext();
  };

  const handleCopy = () => {
    if (!promptText.trim()) return;
    const success = copy(promptText);
    setCopyStatus(success ? 'copied' : 'error');
  };

  const hasSuggestions =
    Boolean(suggestions.suggestedTemplateId) || Boolean(suggestions.suggestedProfileId);
  const templateLabel =
    promptOptions?.templates.find((option) => option.id === suggestions.suggestedTemplateId)
      ?.label ?? '—';
  const profileLabel =
    promptOptions?.profiles.find((option) => option.id === suggestions.suggestedProfileId)
      ?.label ?? '—';
  const suggestionApplied =
    (!suggestions.suggestedTemplateId ||
      suggestions.suggestedTemplateId === templateId) &&
    (!suggestions.suggestedProfileId || suggestions.suggestedProfileId === profileId);

  return (
    <WizardStep
      title="Add notes"
      subtitle="Provide any tutor notes and choose a prompt template before drafting."
      onBack={onBack}
      onNext={handleContinue}
      nextLabel="Continue to draft"
      isNextDisabled={!recordingId || !promptPackageId || isPromptStale || promptLoading}
      isBusy={promptLoading}
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
          <div className="automation-card">
            <div className="automation-header">
              <div>
                <span className="automation-eyebrow">Automation</span>
                <h4>Auto-suggest prompts</h4>
                <p>Recommend prompt templates based on student history.</p>
              </div>
              <label className="automation-toggle">
                <input
                  type="checkbox"
                  checked={autoSuggestEnabled}
                  onChange={(event) =>
                    onAutomationChange({ autoSuggestPrompts: event.target.checked })
                  }
                />
                <span className="toggle-track" aria-hidden="true" />
              </label>
            </div>
            {autoSuggestEnabled && hasSuggestions ? (
              <div className="automation-suggestion">
                <div className="suggestion-block">
                  <span className="suggestion-label">Suggested template</span>
                  <span className="suggestion-value">{templateLabel}</span>
                </div>
                <div className="suggestion-block">
                  <span className="suggestion-label">Suggested profile</span>
                  <span className="suggestion-value">{profileLabel}</span>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => {
                    if (suggestions.suggestedTemplateId) {
                      setTemplateId(suggestions.suggestedTemplateId);
                    }
                    if (suggestions.suggestedProfileId) {
                      setProfileId(suggestions.suggestedProfileId);
                    }
                    autoSuggestAppliedRef.current = true;
                    logLedgerEntries([
                      {
                        type: 'automation_prompt_suggestion_applied',
                        severity: 'info',
                        objectType: 'job',
                        objectId: recordingId ?? 'unassigned',
                        message: 'Applied automated prompt recommendations.',
                        source: 'session',
                      },
                    ]);
                  }}
                  disabled={suggestionApplied}
                >
                  {suggestionApplied ? 'Applied' : 'Apply suggestions'}
                </button>
              </div>
            ) : (
              <p className="automation-muted">
                {autoSuggestEnabled ? 'Recommendations will appear when options load.' : 'Enable to see suggestions.'}
              </p>
            )}
          </div>
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
      <div className="prompt-panel">
        <div className="prompt-header">
          <div>
            <h3>Prompt output</h3>
            <p className="muted">Generate the prompt, copy it to your LLM, and edit if needed.</p>
          </div>
          <div className="prompt-actions">
            <button
              type="button"
              className="btn-secondary btn-small"
              onClick={() => void handleGeneratePrompt()}
              disabled={!recordingId || !templateId || !profileId || promptLoading}
            >
              {promptPackageId ? 'Regenerate prompt' : 'Generate prompt'}
            </button>
            <button
              type="button"
              className="btn-secondary btn-small"
              onClick={handleCopy}
              disabled={!promptText.trim()}
            >
              {copyStatus === 'copied' ? 'Copied' : 'Copy prompt'}
            </button>
          </div>
        </div>
        {promptLoading ? (
          <p className="muted">Building prompt package...</p>
        ) : promptText.trim() ? (
          <textarea
            value={promptText}
            onChange={(event) => setPromptText(event.target.value)}
            rows={12}
            className="prompt-output"
          />
        ) : (
          <p className="muted">Generate a prompt to review it here.</p>
        )}
        {isPromptStale ? (
          <p className="warning-text">Notes or settings changed. Regenerate the prompt.</p>
        ) : null}
        {copyStatus === 'error' ? (
          <p className="warning-text">Copy failed. Select the text and copy manually.</p>
        ) : null}
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

        .automation-card {
          border-radius: var(--radius-lg);
          border: 1px dashed var(--border-light);
          padding: var(--space-3);
          background: rgba(15, 23, 42, 0.04);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .automation-header {
          display: flex;
          justify-content: space-between;
          gap: var(--space-3);
          align-items: flex-start;
        }

        .automation-eyebrow {
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-tertiary);
          font-weight: 600;
        }

        .automation-card h4 {
          margin: var(--space-1) 0 0;
          font-size: var(--text-base);
        }

        .automation-card p {
          margin: 0;
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .automation-toggle {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2);
          cursor: pointer;
        }

        .automation-toggle input {
          position: absolute;
          opacity: 0;
          width: 1px;
          height: 1px;
        }

        .automation-toggle .toggle-track {
          width: 42px;
          height: 24px;
          border-radius: 999px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          position: relative;
          transition: background var(--transition-fast), border-color var(--transition-fast);
        }

        .automation-toggle .toggle-track::after {
          content: '';
          position: absolute;
          top: 3px;
          left: 3px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--text-secondary);
          transition: transform var(--transition-fast), background var(--transition-fast);
        }

        .automation-toggle input:checked + .toggle-track {
          background: rgba(16, 185, 129, 0.16);
          border-color: rgba(16, 185, 129, 0.35);
        }

        .automation-toggle input:checked + .toggle-track::after {
          transform: translateX(18px);
          background: var(--color-success-600);
        }

        .automation-suggestion {
          display: grid;
          gap: var(--space-2);
        }

        .suggestion-block {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .suggestion-label {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 600;
        }

        .suggestion-value {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        .automation-muted {
          font-size: var(--text-sm);
          color: var(--text-tertiary);
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
          color: var(--color-primary-600);
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .prompt-panel {
          margin-top: var(--space-4);
          background: var(--bg-secondary);
          border-radius: var(--radius-xl);
          padding: var(--space-4);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .prompt-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          flex-wrap: wrap;
        }

        .prompt-header h3 {
          margin: 0;
        }

        .prompt-actions {
          display: flex;
          gap: var(--space-2);
          flex-wrap: wrap;
        }

        .prompt-output {
          width: 100%;
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          padding: var(--space-3);
          min-height: 260px;
          background: var(--bg-primary);
          font-family: var(--font-mono);
          font-size: var(--text-sm);
          line-height: var(--leading-relaxed);
        }

        .warning-text {
          color: var(--color-warning-600);
          font-size: var(--text-sm);
          margin: 0;
        }

        .muted {
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }
      `}</style>
    </WizardStep>
  );
};

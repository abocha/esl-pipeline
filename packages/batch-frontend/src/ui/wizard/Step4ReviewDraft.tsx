import React, { useEffect, useRef, useState } from 'react';

import type { DraftResponse, MarkdownValidationResponse } from '../../utils/api';
import { createDraft, fetchDraft, updateDraft, validateMarkdown } from '../../utils/api';
import { useJobMonitor } from '../../context/JobMonitorContext';
import type { SplitEditorHandle } from '../editor/SplitEditor';
import { SplitEditor } from '../editor/SplitEditor';
import { ValidationPanel } from '../editor/ValidationPanel';
import { WizardStep } from './WizardStep';

interface Step4ReviewDraftProps {
  promptPackageId: string | null;
  draftId: string | null;
  draftText: string;
  setDraftText: (value: string) => void;
  autoDraftEnabled: boolean;
  onAutomationChange: (updates: { autoDraftPreview?: boolean }) => void;
  onDraftReady: (draft: DraftResponse) => void;
  onNext: () => void;
  onBack: () => void;
}

export const Step4ReviewDraft: React.FC<Step4ReviewDraftProps> = ({
  promptPackageId,
  draftId,
  draftText,
  setDraftText,
  autoDraftEnabled,
  onAutomationChange,
  onDraftReady,
  onNext,
  onBack,
}) => {
  const { logLedgerEntries } = useJobMonitor();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<MarkdownValidationResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [strictValidation, setStrictValidation] = useState(false);
  const editorRef = useRef<SplitEditorHandle | null>(null);
  const hasValidationErrors = (validation?.errors?.length ?? 0) > 0;
  const autoDraftAvailable = false;

  useEffect(() => {
    if (!autoDraftAvailable && autoDraftEnabled) {
      onAutomationChange({ autoDraftPreview: false });
      logLedgerEntries([
        {
          type: 'automation_auto_draft_unavailable',
          severity: 'warning',
          objectType: 'draft',
          objectId: draftId ?? 'pending',
          message: 'Auto-draft preview is unavailable until LLM draft generation is enabled.',
          source: 'session',
        },
      ]);
    }
  }, [autoDraftAvailable, autoDraftEnabled, draftId, logLedgerEntries, onAutomationChange]);

  useEffect(() => {
    let active = true;
    if (!draftId) return;

    // improved: avoid overwriting existing edits
    if (draftText) {
      return;
    }

    const loadDraft = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchDraft(draftId);
        if (!active) return;
        setDraftText(response.text ?? '');
        onDraftReady(response);
      } catch (loadError) {
        if (!active) return;
        const message = loadError instanceof Error ? loadError.message : 'Unable to load draft';
        setError(message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadDraft();

    return () => {
      active = false;
    };
  }, [draftId, onDraftReady, setDraftText, draftText]);

  useEffect(() => {
    if (!draftText.trim()) {
      setValidation(null);
      setValidationError(null);
      setValidating(false);
      return;
    }

    let active = true;
    const timeout = setTimeout(() => {
      const runValidation = async () => {
        setValidating(true);
        setValidationError(null);
        try {
          const response = await validateMarkdown(draftText, strictValidation);
          if (!active) return;
          setValidation(response);
        } catch (error_) {
          if (!active) return;
          const message =
            error_ instanceof Error
              ? error_.message
              : 'Unable to validate markdown';
          setValidationError(message);
        } finally {
          if (active) {
            setValidating(false);
          }
        }
      };
      void runValidation();
    }, 500);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [draftText, strictValidation]);

  const handleSaveDraft = async () => {
    if (!promptPackageId) {
      setError('Create a prompt package first.');
      return;
    }
    if (!draftText.trim()) {
      setError('Draft text is empty.');
      return;
    }
    if (validating) {
      setError('Validation is still running.');
      return;
    }
    if (hasValidationErrors) {
      setError('Resolve validation errors before publishing.');
      return;
    }
    setLoading(true);
    setError(null);
    setLoading(true);
    setError(null);
    try {
      const response = draftId
        ? await updateDraft(draftId, draftText.trim())
        : await createDraft(promptPackageId, draftText.trim());
      onDraftReady(response);
      onNext();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Unable to save draft';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <WizardStep
      title="Review draft"
      subtitle="Review the generated markdown and make final edits before publishing."
      onBack={onBack}
      onNext={handleSaveDraft}
      nextLabel="Continue to publish"
      isNextDisabled={!promptPackageId || validating || hasValidationErrors}
      isBusy={loading}
    >
      <div className="automation-card">
        <div className="automation-header">
          <div>
            <span className="automation-eyebrow">Automation</span>
            <h4>Auto-draft preview</h4>
            <p>Generate a draft preview automatically before manual edits.</p>
          </div>
          <label className="automation-toggle">
            <input
              type="checkbox"
              checked={autoDraftEnabled}
              disabled={!autoDraftAvailable}
              onChange={(event) =>
                onAutomationChange({ autoDraftPreview: event.target.checked })
              }
            />
            <span className="toggle-track" aria-hidden="true" />
          </label>
        </div>
        {autoDraftAvailable ? (
          <p className="automation-muted">
            Enable to create a first-pass draft preview when the prompt is ready.
          </p>
        ) : (
          <p className="automation-muted">
            Auto-draft preview requires backend LLM generation support. This will be enabled once
            the draft generation endpoint is available.
          </p>
        )}
      </div>
      <div className="draft-layout">
        <SplitEditor ref={editorRef} value={draftText} onChange={setDraftText} />
        <ValidationPanel
          validation={validation}
          error={validationError}
          isValidating={validating}
          strict={strictValidation}
          onToggleStrict={setStrictValidation}
          onJumpToLine={(line) => editorRef.current?.jumpToLine(line)}
        />
      </div>
      {error ? <p className="error-text">{error}</p> : null}

      <style>{`
        .automation-card {
          border-radius: var(--radius-lg);
          border: 1px dashed var(--border-light);
          padding: var(--space-3);
          background: rgba(15, 23, 42, 0.04);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          margin-bottom: var(--space-4);
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

        .automation-toggle input:disabled + .toggle-track {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .automation-muted {
          font-size: var(--text-sm);
          color: var(--text-tertiary);
        }

        .draft-layout {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }
      `}</style>
    </WizardStep>
  );
};

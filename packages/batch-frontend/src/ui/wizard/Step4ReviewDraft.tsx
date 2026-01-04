import React, { useEffect, useMemo, useState } from 'react';

import type { DraftResponse } from '../../utils/api';
import { createDraft, fetchDraft } from '../../utils/api';
import { WizardStep } from './WizardStep';

interface Step4ReviewDraftProps {
  promptPackageId: string | null;
  draftId: string | null;
  draftText: string;
  setDraftText: (value: string) => void;
  onDraftReady: (draft: DraftResponse) => void;
  onNext: () => void;
  onBack: () => void;
}

export const Step4ReviewDraft: React.FC<Step4ReviewDraftProps> = ({
  promptPackageId,
  draftId,
  draftText,
  setDraftText,
  onDraftReady,
  onNext,
  onBack,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!draftId) return;

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
  }, [draftId, onDraftReady, setDraftText]);

  const handleSaveDraft = async () => {
    if (!promptPackageId) {
      setError('Create a prompt package first.');
      return;
    }
    if (!draftText.trim()) {
      setError('Draft text is empty.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await createDraft(promptPackageId, draftText.trim());
      onDraftReady(response);
      onNext();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : 'Unable to save draft';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const preview = useMemo(() => draftText.trim() || 'Draft preview will appear here.', [draftText]);

  return (
    <WizardStep
      title="Review draft"
      subtitle="Review the generated markdown and make final edits before publishing."
      onBack={onBack}
      onNext={handleSaveDraft}
      nextLabel="Continue to publish"
      isNextDisabled={!promptPackageId}
      isBusy={loading}
    >
      <div className="draft-layout">
        <div className="draft-panel">
          <h3>Draft text</h3>
          <textarea
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            rows={14}
            placeholder="Write or paste the draft markdown here..."
          />
        </div>
        <div className="draft-panel">
          <h3>Preview</h3>
          <div className="draft-preview">
            <pre>{preview}</pre>
          </div>
        </div>
      </div>
      {error ? <p className="error-text">{error}</p> : null}

      <style>{`
        .draft-layout {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: var(--space-4);
        }

        .draft-panel {
          background: var(--bg-secondary);
          border-radius: var(--radius-xl);
          padding: var(--space-4);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .draft-panel h3 {
          margin: 0;
        }

        .draft-panel textarea {
          width: 100%;
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          padding: var(--space-3);
          min-height: 240px;
          background: var(--bg-primary);
          font-family: var(--font-mono);
        }

        .draft-preview {
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-medium);
          padding: var(--space-3);
          background: var(--bg-primary);
          min-height: 240px;
          overflow: auto;
        }

        .draft-preview pre {
          margin: 0;
          white-space: pre-wrap;
          font-family: var(--font-mono);
          font-size: var(--text-sm);
        }
      `}</style>
    </WizardStep>
  );
};

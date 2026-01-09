import React, { useEffect, useRef, useState } from 'react';

import type { DraftResponse, MarkdownValidationResponse } from '../../utils/api';
import { createDraft, fetchDraft, updateDraft, validateMarkdown } from '../../utils/api';
import type { SplitEditorHandle } from '../editor/SplitEditor';
import { SplitEditor } from '../editor/SplitEditor';
import { ValidationPanel } from '../editor/ValidationPanel';
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
  const [validation, setValidation] = useState<MarkdownValidationResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [strictValidation, setStrictValidation] = useState(false);
  const editorRef = useRef<SplitEditorHandle | null>(null);

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
      isNextDisabled={!promptPackageId}
      isBusy={loading}
    >
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
        .draft-layout {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }
      `}</style>
    </WizardStep>
  );
};

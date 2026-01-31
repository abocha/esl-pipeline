import React, { useMemo } from 'react';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useStudentSelection } from '../../context/StudentSelectionContext';
import { useWizard } from '../../context/WizardContext';

type ChecklistStatus =
  | 'complete'
  | 'current'
  | 'ready'
  | 'pending'
  | 'blocked'
  | 'processing'
  | 'skipped'
  | 'warning';

const STATUS_LABELS: Record<ChecklistStatus, string> = {
  complete: 'Complete',
  current: 'In progress',
  ready: 'Ready',
  pending: 'Pending',
  blocked: 'Blocked',
  processing: 'Processing',
  skipped: 'Skipped',
  warning: 'Warning',
};

const formatStateLabel = (value: string | null) => {
  if (!value) return 'Pending';
  return value.replaceAll('_', ' ');
};

export const WizardSummary: React.FC = () => {
  const { selectedStudent } = useStudentSelection();
  const { state, actions } = useWizard();
  const { recordingMap, jobMap } = useJobMonitor();
  const {
    currentStep,
    activeJobId,
    recordingId,
    transcriptId,
    transcriptText,
    transcriptSkipped,
    promptPackageId,
    draftId,
    completedJobId,
    jobState,
  } = state;

  const recordingEntry = recordingId ? recordingMap[recordingId] : null;
  const jobEntry = activeJobId ? jobMap[activeJobId] : null;
  const studentDisplay = selectedStudent?.student ?? null;
  const hasRecording = Boolean(recordingId);
  const transcriptReady = Boolean(transcriptText.trim() || transcriptId);
  const transcriptProcessing = Boolean(
    recordingEntry?.status === 'queued' ||
      recordingEntry?.status === 'ingested' ||
      recordingEntry?.status === 'transcribing',
  );
  const transcriptFailed = Boolean(recordingEntry?.status === 'failed' || recordingEntry?.error);
  const promptReady = Boolean(promptPackageId);
  const draftReady = Boolean(draftId);
  const publishReady = draftReady;
  const notionUrl = jobEntry?.notionUrl ?? null;
  const resolvedJobState = jobEntry?.state ?? jobState ?? null;

  const transcriptStatusLabel = transcriptSkipped
    ? 'Skipped'
    : transcriptReady
      ? 'Ready'
      : transcriptFailed
        ? 'Failed'
        : transcriptProcessing
          ? 'Processing'
          : 'Pending';
  const transcriptTone = transcriptSkipped
    ? 'status-warning'
    : transcriptFailed
      ? 'status-error'
      : transcriptProcessing
        ? 'status-processing'
        : transcriptReady
          ? 'ready'
          : 'pending';

  const publishStatusLabel = completedJobId
    ? notionUrl
      ? 'Notion ready'
      : 'Processing'
    : publishReady
      ? 'Ready to publish'
      : 'Blocked';
  const publishTone = completedJobId
    ? notionUrl
      ? 'ready'
      : 'status-processing'
    : publishReady
      ? 'ready'
      : 'status-warning';

  const steps = useMemo(() => {
    const stepItems = [
      {
        label: 'Select and upload',
        entry: 'None',
        exit: 'Recording uploaded',
        action: hasRecording ? 'Review transcript' : 'Upload recording',
        status: hasRecording ? 'complete' : currentStep === 0 ? 'current' : 'pending',
        canNavigate: true,
        navigateTo: 0,
      },
      {
        label: 'Review transcript',
        entry: 'Recording ready',
        exit: 'Transcript ready or skipped',
        action: transcriptSkipped
          ? 'Continue to notes'
          : transcriptReady
            ? 'Continue to notes'
            : transcriptFailed
              ? 'Retry or skip'
              : transcriptProcessing
                ? 'Wait or skip'
                : 'Open transcript',
        status: hasRecording
          ? transcriptSkipped
            ? 'skipped'
            : transcriptReady
              ? 'complete'
              : transcriptFailed
                ? 'blocked'
                : currentStep === 1
                  ? 'current'
                  : transcriptProcessing
                    ? 'processing'
                    : 'pending'
          : 'blocked',
        canNavigate: hasRecording,
        navigateTo: 1,
      },
      {
        label: 'Notes and prompt',
        entry: 'Recording ready',
        exit: 'Prompt package created',
        action: promptReady ? 'Review draft' : 'Generate prompt',
        status: hasRecording
          ? promptReady
            ? 'complete'
            : currentStep === 2
              ? 'current'
              : 'pending'
          : 'blocked',
        canNavigate: hasRecording,
        navigateTo: 2,
      },
      {
        label: 'Draft review',
        entry: 'Prompt package ready',
        exit: 'Draft saved and validated',
        action: draftReady ? 'Publish job' : 'Create draft',
        status: promptReady
          ? draftReady
            ? 'complete'
            : currentStep === 3
              ? 'current'
              : 'pending'
          : 'blocked',
        canNavigate: promptReady,
        navigateTo: 3,
      },
      {
        label: 'Publish',
        entry: 'Draft ready',
        exit: 'Job approved',
        action: completedJobId
          ? notionUrl
            ? 'Open Notion'
            : 'Monitor job'
          : 'Publish job',
        status: completedJobId
          ? notionUrl
            ? 'complete'
            : 'processing'
          : publishReady
            ? currentStep === 4
              ? 'current'
              : 'ready'
            : 'blocked',
        canNavigate: publishReady,
        navigateTo: 4,
      },
      {
        label: 'Receipt',
        entry: 'Job approved',
        exit: 'Notion link delivered',
        action: notionUrl ? 'Open Notion' : 'Wait for Notion link',
        status: completedJobId
          ? notionUrl
            ? 'complete'
            : 'processing'
          : 'pending',
        canNavigate: Boolean(completedJobId),
        navigateTo: 4,
      },
    ];

    return stepItems.map((step, index) => ({
      ...step,
      index,
    }));
  }, [
    completedJobId,
    currentStep,
    draftReady,
    hasRecording,
    notionUrl,
    promptReady,
    publishReady,
    transcriptFailed,
    transcriptProcessing,
    transcriptReady,
    transcriptSkipped,
  ]);

  return (
    <aside className="wizard-summary glass-panel">
      <header className="summary-header">
        <div>
          <h4>Checklist</h4>
          <p>Track every stage and jump to the next best action.</p>
        </div>
      </header>

      <ol className="wizard-checklist">
        {steps.map((step) => {
          const isActive = step.index === currentStep;
          const isDisabled = !step.canNavigate;
          return (
            <li
              key={step.label}
              className={`checklist-step status-${step.status} ${isActive ? 'is-active' : ''}`}
            >
              <button
                type="button"
                onClick={() => actions.goToStep(step.navigateTo)}
                disabled={isDisabled}
              >
                <span className="step-index">{step.index + 1}</span>
                <div className="step-body">
                  <div className="step-title-row">
                    <span className="step-title">{step.label}</span>
                    <span className={`step-status status-${step.status}`}>
                      {STATUS_LABELS[step.status as ChecklistStatus]}
                    </span>
                  </div>
                  <span className="step-criteria">Entry: {step.entry}</span>
                  <span className="step-criteria">Exit: {step.exit}</span>
                  <span className="step-action">Next: {step.action}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="summary-divider" />

      <section className="summary-context">
        <header>
          <h4>Assignment context</h4>
          <p>Live snapshot of the objects powering this assignment.</p>
        </header>

        <div className="context-grid">
          <div className="context-item">
            <span className="context-label">Student</span>
            {studentDisplay ? (
              <span className="context-value">{studentDisplay}</span>
            ) : hasRecording ? (
              <span className="context-value muted">(from previous session)</span>
            ) : (
              <span className="context-value action-hint">Select student in Step 1</span>
            )}
          </div>

          <div className="context-item">
            <span className="context-label">Recording</span>
            {recordingEntry ? (
              <span className="context-value">
                {recordingEntry.displayName ?? recordingId}
                <span className="context-meta">{formatStateLabel(recordingEntry.status)}</span>
              </span>
            ) : (
              <span className="context-value action-hint">Upload in Step 1</span>
            )}
          </div>

          <div className="context-item">
            <span className="context-label">Transcript</span>
            <span className={`context-status ${transcriptTone}`}>
              {transcriptStatusLabel}
            </span>
          </div>

          <div className="context-item">
            <span className="context-label">Prompt package</span>
            <span className={`context-status ${promptReady ? 'ready' : 'pending'}`}>
              {promptReady ? 'Ready' : 'Pending'}
            </span>
          </div>

          <div className="context-item">
            <span className="context-label">Draft</span>
            <span className={`context-status ${draftReady ? 'ready' : 'pending'}`}>
              {draftReady ? 'Ready' : 'Pending'}
            </span>
          </div>

          <div className="context-item">
            <span className="context-label">Publish</span>
            <span className={`context-status ${publishTone}`}>
              {publishStatusLabel}
            </span>
          </div>

          <div className="context-item">
            <span className="context-label">Job state</span>
            <span className="context-value">{formatStateLabel(resolvedJobState)}</span>
          </div>
        </div>
      </section>

      <style>{`
        .wizard-summary {
          padding: var(--space-4);
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
          min-width: 240px;
          position: relative;
          overflow: hidden;
        }

        .wizard-summary::before {
          content: '';
          position: absolute;
          top: -40%;
          right: -30%;
          width: 280px;
          height: 280px;
          background: radial-gradient(circle, rgba(59, 130, 246, 0.16), rgba(255, 255, 255, 0));
          opacity: 0.6;
          pointer-events: none;
        }

        .summary-header h4,
        .summary-context h4 {
          margin: 0;
          font-size: var(--text-sm);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-secondary);
        }

        .summary-header p,
        .summary-context p {
          margin: var(--space-1) 0 0;
          color: var(--text-tertiary);
          font-size: var(--text-xs);
        }

        .wizard-checklist {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          position: relative;
          z-index: 1;
        }

        .checklist-step {
          position: relative;
        }

        .checklist-step::before {
          content: '';
          position: absolute;
          left: 18px;
          top: 36px;
          bottom: -14px;
          width: 2px;
          background: var(--border-light);
          opacity: 0.6;
        }

        .checklist-step:last-child::before {
          display: none;
        }

        .checklist-step button {
          width: 100%;
          background: transparent;
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xl);
          padding: var(--space-3);
          display: grid;
          grid-template-columns: 32px 1fr;
          gap: var(--space-3);
          text-align: left;
          align-items: start;
          transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
        }

        .checklist-step button:disabled {
          cursor: not-allowed;
          opacity: 0.7;
        }

        .checklist-step.is-active button {
          border-color: rgba(59, 130, 246, 0.5);
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.12);
        }

        .step-index {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: var(--text-xs);
          font-weight: 700;
          background: var(--bg-tertiary);
          color: var(--text-tertiary);
        }

        .checklist-step.status-complete .step-index,
        .checklist-step.status-ready .step-index {
          background: rgba(34, 197, 94, 0.16);
          color: var(--color-success-600);
        }

        .checklist-step.status-skipped .step-index,
        .checklist-step.status-warning .step-index {
          background: rgba(245, 158, 11, 0.16);
          color: var(--color-warning-600);
        }

        .checklist-step.status-blocked .step-index {
          background: rgba(239, 68, 68, 0.16);
          color: var(--color-error-600);
        }

        .checklist-step.status-current .step-index,
        .checklist-step.status-processing .step-index {
          background: rgba(59, 130, 246, 0.16);
          color: var(--color-primary-600);
        }

        .step-body {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .step-title-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--space-2);
        }

        .step-title {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        .step-status {
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: var(--radius-full);
          background: var(--bg-secondary);
          color: var(--text-tertiary);
        }

        .step-status.status-complete,
        .step-status.status-ready {
          background: rgba(34, 197, 94, 0.16);
          color: var(--color-success-600);
        }

        .step-status.status-skipped,
        .step-status.status-warning {
          background: rgba(245, 158, 11, 0.16);
          color: var(--color-warning-600);
        }

        .step-status.status-blocked {
          background: rgba(239, 68, 68, 0.16);
          color: var(--color-error-600);
        }

        .step-status.status-current,
        .step-status.status-processing {
          background: rgba(59, 130, 246, 0.16);
          color: var(--color-primary-600);
        }

        .step-criteria {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .step-action {
          font-size: var(--text-xs);
          font-weight: 600;
          color: var(--color-primary-600);
        }

        .summary-divider {
          height: 1px;
          background: var(--border-light);
          opacity: 0.7;
        }

        .summary-context {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          position: relative;
          z-index: 1;
        }

        .context-grid {
          display: grid;
          gap: var(--space-3);
        }

        .context-item {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .context-label {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .context-value {
          font-size: var(--text-sm);
          color: var(--text-primary);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .context-value.muted {
          color: var(--text-tertiary);
          font-style: italic;
        }

        .context-value.action-hint {
          color: var(--color-primary-500);
          font-size: var(--text-xs);
        }

        .context-meta {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .context-status {
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          padding: 2px 8px;
          border-radius: var(--radius-full);
          width: fit-content;
          background: var(--bg-secondary);
          color: var(--text-tertiary);
        }

        .context-status.ready {
          background: rgba(34, 197, 94, 0.16);
          color: var(--color-success-600);
        }

        .context-status.pending {
          background: var(--bg-secondary);
          color: var(--text-tertiary);
        }

        .context-status.status-warning {
          background: rgba(245, 158, 11, 0.16);
          color: var(--color-warning-600);
        }

        .context-status.status-error {
          background: rgba(239, 68, 68, 0.16);
          color: var(--color-error-600);
        }

        .context-status.status-processing {
          background: rgba(59, 130, 246, 0.16);
          color: var(--color-primary-600);
        }

        @media (max-width: 1024px) {
          .wizard-summary {
            display: none;
          }
        }
      `}</style>
    </aside>
  );
};

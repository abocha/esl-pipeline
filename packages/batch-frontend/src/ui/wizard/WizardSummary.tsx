import React from 'react';

import { useStudentSelection } from '../../context/StudentSelectionContext';
import { useWizard } from '../../context/WizardContext';

/**
 * WizardSummary - Displays current wizard context as a sidebar summary.
 * 
 * Features:
 * - Null-safe rendering for all fields
 * - Action-oriented empty states
 * - Deep-link fallback when student context is unavailable
 * - Collapses on mobile via CSS
 */
export const WizardSummary: React.FC = () => {
  const { selectedStudent } = useStudentSelection();
  const { state } = useWizard();
  const { recordingId, promptPackageId, draftId } = state;

  const studentDisplay = selectedStudent?.student ?? null;
  const hasRecording = Boolean(recordingId);

  return (
    <aside className="wizard-summary glass-panel">
      <h4 className="summary-title">Context</h4>

      <div className="summary-section">
        <span className="summary-label">Student</span>
        {studentDisplay ? (
          <span className="summary-value">{studentDisplay}</span>
        ) : hasRecording ? (
          <span className="summary-value muted">(from previous session)</span>
        ) : (
          <span className="summary-value action-hint">Select student in Step 1</span>
        )}
      </div>

      <div className="summary-section">
        <span className="summary-label">Recording</span>
        {recordingId ? (
          <span className="summary-value mono">{recordingId.slice(0, 8)}...</span>
        ) : (
          <span className="summary-value action-hint">Upload in Step 1</span>
        )}
      </div>

      <div className="summary-section">
        <span className="summary-label">Prompt Package</span>
        <span className={`summary-status ${promptPackageId ? 'ready' : 'pending'}`}>
          {promptPackageId ? 'Created' : 'Pending'}
        </span>
      </div>

      <div className="summary-section">
        <span className="summary-label">Draft</span>
        <span className={`summary-status ${draftId ? 'ready' : 'pending'}`}>
          {draftId ? 'Created' : 'Pending'}
        </span>
      </div>

      <style>{`
        .wizard-summary {
          padding: var(--space-4);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          min-width: 200px;
        }

        .summary-title {
          margin: 0;
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .summary-section {
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .summary-label {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .summary-value {
          font-size: var(--text-sm);
          color: var(--text-primary);
        }

        .summary-value.muted {
          color: var(--text-tertiary);
          font-style: italic;
        }

        .summary-value.mono {
          font-family: var(--font-mono);
          font-size: var(--text-xs);
        }

        .summary-value.action-hint {
          color: var(--color-primary-500);
          font-size: var(--text-xs);
        }

        .summary-status {
          font-size: var(--text-xs);
          font-weight: 500;
          padding: var(--space-1) var(--space-2);
          border-radius: var(--radius-sm);
          width: fit-content;
        }

        .summary-status.ready {
          background: rgba(34, 197, 94, 0.1);
          color: var(--color-success-500);
        }

        .summary-status.pending {
          background: var(--bg-secondary);
          color: var(--text-tertiary);
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

import { ArrowLeft, AudioLines, BookOpen, Check, Send, Sparkles, UserRound } from 'lucide-react';
import type React from 'react';

import { ProductButton } from '../system/ProductButton';
import type { AssignmentStepId, AssignmentWorkflowStep } from './assignment-workflow';

import './AssignmentWorkflow.css';

export interface AssignmentWorkflowProps {
  steps: readonly AssignmentWorkflowStep[];
  activeStep: AssignmentStepId;
  highestAvailableStep: AssignmentStepId;
  saveState: 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'ambiguous';
  guidance?: React.ReactNode;
  postFooter?: React.ReactNode;
  support?: React.ReactNode;
  onStepRequest: (step: AssignmentStepId) => void;
  onBack: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  continueFeedback?: React.ReactNode;
  onComplete?: () => void;
  completionLabel?: string;
  children: React.ReactNode;
}

const stepIcons = {
  student: UserRound,
  source: AudioLines,
  context: BookOpen,
  assignment: Sparkles,
  review: Send,
} as const;

const saveLabels = {
  idle: 'Changes save as you work',
  saving: 'Saving…',
  saved: 'All changes saved',
  error: 'Saving needs attention',
  conflict: 'Newer saved work found',
  ambiguous: 'Checking whether the change completed',
} as const;

export function AssignmentWorkflow({
  steps,
  activeStep,
  saveState,
  guidance,
  postFooter,
  support,
  onStepRequest,
  onBack,
  onContinue,
  continueLabel,
  continueDisabled = false,
  continueFeedback,
  onComplete,
  completionLabel,
  children,
}: AssignmentWorkflowProps) {
  return (
    <section className="assignment-workflow" aria-label="Assignment builder">
      <div className="assignment-workflow__status">
        <span
          className={`assignment-workflow__save assignment-workflow__save--${saveState}`}
          role="status"
          aria-live="polite"
        >
          {saveState === 'saved' ? <Check aria-hidden="true" /> : null}
          {saveLabels[saveState]}
        </span>
      </div>

      <nav className="assignment-workflow__progress" aria-label="Assignment progress">
        <ol>
          {steps.map((step, index) => {
            const Icon = stepIcons[step.id];
            const visualStatus = step.id === activeStep ? 'current' : step.status;
            const disabled = visualStatus === 'locked';
            return (
              <li key={step.id} data-status={visualStatus}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-current={step.id === activeStep ? 'step' : undefined}
                  onClick={() => onStepRequest(step.id)}
                >
                  <span className="assignment-workflow__step-icon">
                    {visualStatus === 'complete' ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Icon aria-hidden="true" />
                    )}
                  </span>
                  <span className="assignment-workflow__step-copy">
                    <small>Step {index + 1}</small>
                    <strong>{step.label}</strong>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div
        className={`assignment-workflow__layout${guidance ? '' : ' assignment-workflow__layout--single'}`}
      >
        <div className="assignment-workflow__canvas">{children}</div>
        {guidance ? <aside className="assignment-workflow__guidance">{guidance}</aside> : null}
      </div>

      <footer className="assignment-workflow__footer">
        {activeStep !== 'student' ? (
          <ProductButton variant="quiet" icon={<ArrowLeft />} onClick={onBack}>
            Back
          </ProductButton>
        ) : null}
        <div className="assignment-workflow__footer-action">
          {continueFeedback ? (
            <div className="assignment-workflow__footer-feedback">{continueFeedback}</div>
          ) : null}
          {onComplete && completionLabel ? (
            <ProductButton onClick={onComplete}>{completionLabel}</ProductButton>
          ) : onContinue && continueLabel ? (
            <ProductButton onClick={onContinue} disabled={continueDisabled}>
              {continueLabel}
            </ProductButton>
          ) : null}
        </div>
      </footer>

      {postFooter ? <div className="assignment-workflow__post-footer">{postFooter}</div> : null}

      {support ? <div className="assignment-workflow__support">{support}</div> : null}
    </section>
  );
}

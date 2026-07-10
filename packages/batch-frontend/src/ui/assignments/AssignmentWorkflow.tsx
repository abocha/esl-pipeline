import { ArrowLeft, AudioLines, BookOpen, Check, Send, Sparkles, UserRound } from 'lucide-react';
import type React from 'react';

import { ProductButton } from '../system/ProductButton';
import type { AssignmentStepId, AssignmentWorkflowStep } from './assignment-workflow';

import './AssignmentWorkflow.css';

export interface AssignmentWorkflowProps {
  steps: readonly AssignmentWorkflowStep[];
  activeStep: AssignmentStepId;
  highestAvailableStep: AssignmentStepId;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  guidance?: React.ReactNode;
  support?: React.ReactNode;
  onStepRequest: (step: AssignmentStepId) => void;
  onBack: () => void;
  onContinue: () => void;
  continueLabel: string;
  continueDisabled?: boolean;
  children: React.ReactNode;
}

const stepIcons = {
  student: UserRound,
  source: AudioLines,
  context: BookOpen,
  create: Sparkles,
  review: Send,
} as const;

const saveLabels = {
  idle: 'Changes save as you work',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save needs attention',
} as const;

export function AssignmentWorkflow({
  steps,
  activeStep,
  saveState,
  guidance,
  support,
  onStepRequest,
  onBack,
  onContinue,
  continueLabel,
  continueDisabled = false,
  children,
}: AssignmentWorkflowProps) {
  const active = steps.find((step) => step.id === activeStep) ?? steps[0];

  return (
    <section className="assignment-workflow" aria-labelledby="assignment-workflow-title">
      <header className="assignment-workflow__header">
        <div>
          <p className="assignment-workflow__eyebrow">Assignment builder</p>
          <h1 id="assignment-workflow-title">{active?.label ?? 'Assignment'}</h1>
        </div>
        <span className={`assignment-workflow__save assignment-workflow__save--${saveState}`}>
          {saveState === 'saved' ? <Check aria-hidden="true" /> : null}
          {saveLabels[saveState]}
        </span>
      </header>

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
        <ProductButton variant="quiet" icon={<ArrowLeft />} onClick={onBack}>
          Back
        </ProductButton>
        <ProductButton onClick={onContinue} disabled={continueDisabled}>
          {continueLabel}
        </ProductButton>
      </footer>

      {support ? <div className="assignment-workflow__support">{support}</div> : null}
    </section>
  );
}

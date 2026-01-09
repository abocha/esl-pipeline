import React from 'react';

import { Icons } from '../shared/Icons';

interface StepInfo {
  label: string;
  icon?: React.ReactNode;
}

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  labels?: string[];
  steps?: StepInfo[];
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({
  currentStep,
  totalSteps,
  labels = [],
  steps,
}) => {
  const resolvedSteps: StepInfo[] =
    steps?.length
      ? steps
      : Array.from({ length: totalSteps }).map((_, index) => ({
          label: labels[index] ?? `Step ${index + 1}`,
        }));

  return (
    <div className="step-indicator">
      <div className="step-progress">
        {Array.from({ length: totalSteps }).map((_, index) => {
          const stepNumber = index + 1;
          const isActive = stepNumber === currentStep;
          const isCompleted = stepNumber < currentStep;
          const isFuture = stepNumber > currentStep;
          const step = resolvedSteps[index];
          let stepContent: React.ReactNode = (
            <span className="step-number">{stepNumber}</span>
          );
          if (step?.icon) {
            stepContent = step.icon;
          }
          if (isCompleted) {
            stepContent = <Icons.Check />;
          }

          return (
            <React.Fragment key={stepNumber}>
              {/* Connector Line */}
              {index > 0 && (
                <div
                  className={`step-connector ${isCompleted || isActive ? 'completed' : ''}`}
                />
              )}

              {/* Step Circle */}
              <div
                className={`step-circle ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''} ${isFuture ? 'future' : ''}`}
                title={step?.label ?? labels[index] ?? `Step ${stepNumber}`}
                aria-current={isActive ? 'step' : undefined}
              >
                {stepContent}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Optional Mobile Label for Active Step */}
      <div className="current-step-label">
        <span className="label-text">
          {resolvedSteps[currentStep - 1]?.label ?? `Step ${currentStep}`}
        </span>
        <span className="label-counter">
          {currentStep} of {totalSteps}
        </span>
      </div>

      <style>{`
        .step-indicator {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-4);
          width: 100%;
          padding: var(--space-4) 0;
        }

        .step-progress {
          display: flex;
          align-items: center;
          position: relative;
        }

        .step-connector {
          height: 2px;
          width: 40px;
          background: var(--bg-tertiary);
          transition: background 0.4s ease;
        }

        .step-connector.completed {
          background: var(--gradient-primary);
        }

        .step-circle {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: var(--text-sm);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          border: 2px solid transparent;
          position: relative;
          z-index: 1;
        }

        .step-circle.future {
          background: var(--bg-tertiary);
          color: var(--text-tertiary);
        }

        .step-circle.active {
          background: var(--gradient-primary);
          color: white;
          box-shadow: 0 0 0 4px var(--color-primary-100);
          transform: scale(1.1);
        }
        
        [data-theme='dark'] .step-circle.active {
          box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.2);
        }

        .step-circle.completed {
          background: var(--gradient-primary);
          color: white;
        }
        
        .step-circle svg {
          width: 16px;
          height: 16px;
        }

        .current-step-label {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--space-1);
          animation: fadeInUp 0.4s ease-out;
        }

        .label-text {
          font-weight: 600;
          color: var(--text-primary);
          font-size: var(--text-sm);
        }

        .label-counter {
          color: var(--text-tertiary);
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        
        @media (max-width: 640px) {
          .step-connector {
            width: 24px;
          }
          
          .step-circle {
            width: 28px;
            height: 28px;
            font-size: var(--text-xs);
          }
          
          .step-circle.active {
             transform: scale(1.05);
          }
        }
      `}</style>
    </div>
  );
};

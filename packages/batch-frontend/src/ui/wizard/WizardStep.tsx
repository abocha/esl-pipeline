import React from 'react';

interface WizardStepProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  onSkip?: () => void;
  nextLabel?: string;
  backLabel?: string;
  skipLabel?: string;
  isNextDisabled?: boolean;
  isBusy?: boolean;
}

export const WizardStep: React.FC<WizardStepProps> = ({
  title,
  subtitle,
  children,
  onBack,
  onNext,
  onSkip,
  nextLabel = 'Continue',
  backLabel = 'Back',
  skipLabel = 'Skip',
  isNextDisabled,
  isBusy,
}) => {
  return (
    <section className="wizard-step card animate-fade-in-up">
      <header className="wizard-step-header">
        <div>
          <p className="wizard-step-eyebrow">Wizard Step</p>
          <h2>{title}</h2>
          {subtitle ? <p className="wizard-step-subtitle">{subtitle}</p> : null}
        </div>
      </header>

      <div className="wizard-step-body">{children}</div>

      <footer className="wizard-step-footer">
        <div className="wizard-step-actions">
          {onBack ? (
            <button type="button" className="btn-secondary" onClick={onBack}>
              {backLabel}
            </button>
          ) : (
            <span />
          )}
          <div className="wizard-step-actions-right">
            {onSkip ? (
              <button type="button" className="btn-ghost" onClick={onSkip}>
                {skipLabel}
              </button>
            ) : null}
            {onNext ? (
              <button
                type="button"
                className="btn-primary"
                onClick={onNext}
                disabled={isNextDisabled || isBusy}
              >
                {isBusy ? 'Working...' : nextLabel}
              </button>
            ) : null}
          </div>
        </div>
      </footer>

      <style>{`
        .wizard-step {
          display: flex;
          flex-direction: column;
          gap: var(--space-5);
        }

        .wizard-step-header h2 {
          margin: 0;
          font-size: var(--text-2xl);
          font-family: var(--font-display);
        }

        .wizard-step-eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--color-primary-500);
          margin-bottom: var(--space-2);
        }

        .wizard-step-subtitle {
          margin: var(--space-2) 0 0;
          color: var(--text-tertiary);
        }

        .wizard-step-body {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .wizard-step-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .wizard-step-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          width: 100%;
        }

        .wizard-step-actions-right {
          display: flex;
          align-items: center;
          gap: var(--space-2);
        }

        @media (max-width: 640px) {
          .wizard-step-actions {
            flex-direction: column;
            align-items: stretch;
          }

          .wizard-step-actions-right {
            justify-content: space-between;
          }
        }
      `}</style>
    </section>
  );
};

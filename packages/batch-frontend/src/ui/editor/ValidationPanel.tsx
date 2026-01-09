import React from 'react';

import type { MarkdownValidationResponse } from '../../utils/api';

interface ValidationPanelProps {
  validation: MarkdownValidationResponse | null;
  error: string | null;
  isValidating: boolean;
  strict: boolean;
  onToggleStrict: (next: boolean) => void;
  onJumpToLine?: (lineNumber: number) => void;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = ({
  validation,
  error,
  isValidating,
  strict,
  onToggleStrict,
  onJumpToLine,
}) => {
  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const hasIssues = errors.length > 0 || warnings.length > 0;

  return (
    <section className="validation-panel">
      <header className="validation-header">
        <div>
          <span className="eyebrow">Validation</span>
          <h3>Markdown check</h3>
        </div>
        <label className="validation-toggle">
          <input
            type="checkbox"
            checked={strict}
            onChange={(event) => onToggleStrict(event.target.checked)}
          />
          Strict mode
        </label>
      </header>

      {isValidating ? <p className="muted">Validating markdown...</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!isValidating && !error && !validation ? (
        <p className="muted">Validation results will appear here.</p>
      ) : null}

      {validation ? (
        <div className="validation-body">
          <div className={`validation-status ${hasIssues ? 'warn' : 'ok'}`}>
            {hasIssues ? 'Issues found' : 'Looks good'}
          </div>

          {errors.length > 0 && (
            <div className="validation-block">
              <h4>Errors</h4>
              <ul>
                {errors.map((item, index) => {
                  const lineNumber = extractLineNumber(item);
                  const displayText = lineNumber ? stripLinePrefix(item) : item;
                  return (
                    <li key={`${item}-${index}`}>
                      {lineNumber && onJumpToLine ? (
                        <button
                          type="button"
                          className="validation-link"
                          onClick={() => onJumpToLine(lineNumber)}
                        >
                          <span className="validation-line">Line {lineNumber}</span>
                          {displayText}
                        </button>
                      ) : (
                        item
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="validation-block">
              <h4>Warnings</h4>
              <ul>
                {warnings.map((item, index) => {
                  const lineNumber = extractLineNumber(item);
                  const displayText = lineNumber ? stripLinePrefix(item) : item;
                  return (
                    <li key={`${item}-${index}`}>
                      {lineNumber && onJumpToLine ? (
                        <button
                          type="button"
                          className="validation-link"
                          onClick={() => onJumpToLine(lineNumber)}
                        >
                          <span className="validation-line">Line {lineNumber}</span>
                          {displayText}
                        </button>
                      ) : (
                        item
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {validation.meta ? (
            <div className="validation-meta">
              <div>
                <span className="label">Title</span>
                <span>{validation.meta.title}</span>
              </div>
              <div>
                <span className="label">Student</span>
                <span>{validation.meta.student}</span>
              </div>
              <div>
                <span className="label">Level</span>
                <span>{validation.meta.level}</span>
              </div>
              <div>
                <span className="label">Topic</span>
                <span>
                  {Array.isArray(validation.meta.topic)
                    ? validation.meta.topic.join(', ')
                    : validation.meta.topic}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <style>{`
        .validation-panel {
          background: var(--bg-secondary);
          border-radius: var(--radius-xl);
          padding: var(--space-4);
          border: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .validation-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          flex-wrap: wrap;
        }

        .validation-header h3 {
          margin: 0;
          font-size: var(--text-lg);
        }

        .validation-panel .eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-primary-500);
        }

        .validation-toggle {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-tertiary);
        }

        .validation-toggle input {
          accent-color: var(--color-primary-500);
        }

        .validation-body {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
        }

        .validation-status {
          align-self: flex-start;
          padding: var(--space-1) var(--space-3);
          border-radius: var(--radius-full);
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          font-weight: 600;
        }

        .validation-status.ok {
          background: rgba(16, 185, 129, 0.16);
          color: var(--color-success-600);
        }

        .validation-status.warn {
          background: rgba(245, 158, 11, 0.16);
          color: var(--color-warning-600);
        }

        .validation-block h4 {
          margin: 0 0 var(--space-2);
          font-size: var(--text-sm);
        }

        .validation-block ul {
          margin: 0;
          padding-left: var(--space-4);
          color: var(--text-secondary);
          font-size: var(--text-sm);
          display: grid;
          gap: var(--space-1);
        }

        .validation-link {
          display: inline-flex;
          align-items: center;
          gap: var(--space-2);
          background: transparent;
          border: none;
          color: inherit;
          text-align: left;
          padding: 0;
          cursor: pointer;
          font-size: inherit;
        }

        .validation-line {
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 600;
          color: var(--color-primary-500);
        }

        .validation-meta {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: var(--space-2);
          font-size: var(--text-xs);
          color: var(--text-secondary);
        }

        .validation-meta .label {
          display: block;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-tertiary);
          margin-bottom: var(--space-1);
        }

        .validation-panel .muted {
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }

        .validation-panel .error-text {
          color: var(--color-error-500);
          font-size: var(--text-sm);
        }
      `}</style>
    </section>
  );
};

function extractLineNumber(message: string): number | null {
  const match = message.match(/\bline\s+(\d+)\b/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? '', 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function stripLinePrefix(message: string): string {
  return message
    .replace(/\bline\s+\d+\b:?\s*/i, '')
    .trim();
}

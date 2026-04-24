import React from 'react';
import { Link } from 'react-router-dom';

type StudentAreaTone = 'quiet' | 'success' | 'attention' | 'warning';

function joinClassNames(...classNames: (string | false | null | undefined)[]): string {
  return classNames.filter(Boolean).join(' ');
}

export function StudentAreaDesignSystemStyles(): React.JSX.Element {
  return (
    <style data-student-area-design-system="true">{`
      .student-area-theme {
        --student-area-paper: var(--app-paper);
        --student-area-paper-deep: var(--app-paper-deep);
        --student-area-ink: var(--app-ink);
        --student-area-muted: var(--app-muted);
        --student-area-blue: var(--app-blue);
        --student-area-blue-soft: var(--app-blue-soft);
        --student-area-sage: var(--app-sage);
        --student-area-sage-soft: var(--app-sage-soft);
        --student-area-amber: var(--app-amber);
        --student-area-amber-soft: var(--app-amber-soft);
        --student-area-rose: var(--app-rose);
        --student-area-rose-soft: var(--app-rose-soft);
        --student-area-line: var(--app-line);
        --student-area-panel: var(--app-panel);
        --student-area-radius-lg: var(--app-radius-lg);
        --student-area-radius-md: var(--app-radius-md);
        --student-area-radius-sm: var(--app-radius-sm);
        --student-area-shadow: var(--app-shadow);
        --student-area-shadow-soft: var(--app-shadow-soft);
        --student-area-serif: var(--app-serif);
      }

      .student-area-frame {
        position: relative;
        display: grid;
        gap: 1.35rem;
        overflow: hidden;
        border: 1px solid var(--student-area-line);
        border-radius: var(--student-area-radius-lg);
        background:
          linear-gradient(135deg, rgba(255, 252, 245, 0.98), rgba(247, 239, 226, 0.92));
        box-shadow: var(--student-area-shadow);
      }

      .student-area-frame::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0.32;
        background-image:
          linear-gradient(rgba(42, 36, 26, 0.035) 1px, transparent 1px),
          linear-gradient(90deg, rgba(42, 36, 26, 0.025) 1px, transparent 1px);
        background-size: 44px 44px;
      }

      .student-area-frame > * {
        position: relative;
      }

      .student-area-panel {
        display: grid;
        gap: 1rem;
        border: 1px solid var(--student-area-line);
        border-radius: var(--student-area-radius-md);
        background: var(--student-area-panel);
        box-shadow: var(--student-area-shadow-soft);
      }

      .student-area-panel-quiet {
        background: var(--student-area-panel);
      }

      .student-area-panel-success {
        border-color: rgba(49, 92, 58, 0.16);
        background: linear-gradient(135deg, rgba(240, 247, 236, 0.94), rgba(255, 253, 248, 0.72));
      }

      .student-area-panel-attention {
        border-color: rgba(145, 98, 12, 0.2);
        background: linear-gradient(135deg, rgba(255, 248, 229, 0.96), rgba(255, 253, 248, 0.74));
      }

      .student-area-panel-warning {
        border-color: rgba(143, 63, 50, 0.2);
        background: linear-gradient(135deg, rgba(250, 232, 226, 0.94), rgba(255, 253, 248, 0.74));
      }

      .student-area-section-label {
        margin: 0;
        color: var(--student-area-blue);
        font-size: 0.76rem;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .student-area-metric-card {
        display: grid;
        gap: 0.35rem;
        min-width: 0;
        padding: 1rem;
        border: 1px solid var(--student-area-line);
        border-radius: 18px;
        background: rgba(255, 253, 248, 0.74);
      }

      .student-area-metric-card-success {
        border-color: rgba(49, 92, 58, 0.16);
        background: var(--student-area-sage-soft);
      }

      .student-area-metric-card-attention {
        border-color: rgba(145, 98, 12, 0.18);
        background: var(--student-area-amber-soft);
      }

      .student-area-metric-card-warning {
        border-color: rgba(143, 63, 50, 0.18);
        background: var(--student-area-rose-soft);
      }

      .student-area-metric-card strong {
        color: var(--student-area-ink);
        font-family: var(--student-area-serif);
        font-size: clamp(1.25rem, 2vw, 1.65rem);
        font-weight: 500;
        line-height: 1.12;
      }

      .student-area-metric-card span,
      .student-area-metric-card small {
        color: var(--student-area-muted);
      }

      .student-area-action-link {
        width: fit-content;
        padding: 0.58rem 0.85rem;
        border: 1px solid rgba(20, 63, 115, 0.14);
        border-radius: var(--student-area-radius-sm);
        background: var(--student-area-blue-soft);
        color: var(--student-area-blue);
        font-weight: 700;
        text-decoration: none;
        transition: transform 160ms ease, background-color 160ms ease;
      }

      .student-area-action-link:hover {
        transform: translateY(-1px);
      }

      .student-area-status-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        width: fit-content;
        padding: 0.42rem 0.68rem;
        border-radius: 999px;
        background: var(--student-area-blue-soft);
        color: var(--student-area-blue);
        font-size: 0.82rem;
        font-weight: 800;
      }

      .student-area-status-pill-success {
        background: var(--student-area-sage-soft);
        color: var(--student-area-sage);
      }

      .student-area-status-pill-attention {
        background: var(--student-area-amber-soft);
        color: var(--student-area-amber);
      }

      .student-area-status-pill-warning {
        background: var(--student-area-rose-soft);
        color: var(--student-area-rose);
      }

      .student-area-empty-state {
        display: grid;
        gap: 0.7rem;
        padding: clamp(2rem, 6vw, 4rem);
        border: 1px dashed var(--student-area-line);
        border-radius: var(--student-area-radius-md);
        background: rgba(255, 252, 245, 0.48);
        text-align: center;
      }

      .student-area-note {
        justify-self: center;
        margin: 0;
        color: var(--student-area-blue);
        font-family: var(--student-area-serif);
        font-style: italic;
        letter-spacing: 0.06em;
      }

      .student-area-skeleton {
        display: block;
        min-width: 0;
        overflow: hidden;
        position: relative;
        border-radius: 999px;
        background:
          linear-gradient(90deg, rgba(20, 63, 115, 0.045), rgba(49, 92, 58, 0.075), rgba(20, 63, 115, 0.045)),
          rgba(42, 36, 26, 0.055);
        background-size: 180% 100%;
        animation: student-area-skeleton-breathe 1900ms ease-in-out infinite;
      }

      @keyframes student-area-skeleton-breathe {
        50% {
          background-position: 100% 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .student-area-action-link,
        .student-area-skeleton {
          transition: none;
          animation: none;
        }
      }
    `}</style>
  );
}

export function StudentAreaFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <div className={joinClassNames('student-area-frame', className)}>{children}</div>;
}

export function StudentAreaPanel({
  children,
  className,
  tone = 'quiet',
}: {
  children: React.ReactNode;
  className?: string;
  tone?: StudentAreaTone;
}): React.JSX.Element {
  return (
    <article
      className={joinClassNames('student-area-panel', `student-area-panel-${tone}`, className)}
    >
      {children}
    </article>
  );
}

export function StudentAreaSectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <p className={joinClassNames('student-area-section-label', className)}>{children}</p>;
}

export function StudentAreaMetricCard({
  detail,
  eyebrow,
  tone = 'quiet',
  value,
}: {
  detail?: string;
  eyebrow: string;
  tone?: StudentAreaTone;
  value: string;
}): React.JSX.Element {
  return (
    <div className={joinClassNames('student-area-metric-card', `student-area-metric-card-${tone}`)}>
      <span className="student-area-section-label">{eyebrow}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export function StudentAreaActionLink({
  children,
  className,
  to,
}: {
  children: React.ReactNode;
  className?: string;
  to: string;
}): React.JSX.Element {
  return (
    <Link className={joinClassNames('student-area-action-link', className)} to={to}>
      {children}
    </Link>
  );
}

export function StudentAreaStatusPill({
  children,
  className,
  tone = 'quiet',
}: {
  children: React.ReactNode;
  className?: string;
  tone?: StudentAreaTone;
}): React.JSX.Element {
  return (
    <span
      className={joinClassNames(
        'student-area-status-pill',
        `student-area-status-pill-${tone}`,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StudentAreaEmptyState({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <article className={joinClassNames('student-area-empty-state', className)}>
      {children}
    </article>
  );
}

export function StudentAreaSkeleton({ className }: { className?: string }): React.JSX.Element {
  return <span aria-hidden="true" className={joinClassNames('student-area-skeleton', className)} />;
}

export function StudentAreaNote({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <p className={joinClassNames('student-area-note', className)}>{children}</p>;
}

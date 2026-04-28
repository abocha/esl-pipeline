import React from 'react';
import { Link } from 'react-router-dom';

import './StudentAreaDesignSystem.css';

type StudentAreaTone = 'quiet' | 'success' | 'attention' | 'warning';

function joinClassNames(...classNames: (string | false | null | undefined)[]): string {
  return classNames.filter(Boolean).join(' ');
}

export function StudentAreaDesignSystemStyles(): React.JSX.Element {
  return <span data-student-area-design-system="true" hidden />;
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
    <article className={joinClassNames('student-area-empty-state', className)}>{children}</article>
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

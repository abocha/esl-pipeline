import { Wrench } from 'lucide-react';
import type React from 'react';

export interface SupportDetailsProps {
  summary: React.ReactNode;
  children: React.ReactNode;
  open?: boolean;
  className?: string;
}

export function SupportDetails({ summary, children, open, className = '' }: SupportDetailsProps) {
  return (
    <details className={`support-details ${className}`.trim()} open={open}>
      <summary>
        <Wrench aria-hidden="true" size={16} />
        {summary}
      </summary>
      <div className="support-details__content">{children}</div>
    </details>
  );
}

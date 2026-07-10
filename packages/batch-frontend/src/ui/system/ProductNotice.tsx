import type React from 'react';

export interface ProductNoticeProps {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title: string;
  icon?: React.ReactElement<{ 'aria-hidden'?: boolean }>;
  children: React.ReactNode;
  className?: string;
}

export function ProductNotice({
  tone = 'info',
  title,
  icon,
  children,
  className = '',
}: ProductNoticeProps) {
  return (
    <aside
      className={`product-notice product-notice--${tone} ${className}`.trim()}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : <span aria-hidden="true">•</span>}
      <div>
        <p className="product-notice__title">{title}</p>
        <div className="product-notice__body">{children}</div>
      </div>
    </aside>
  );
}

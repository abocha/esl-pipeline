import type React from 'react';

export interface ProductButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  busy?: boolean;
  icon?: React.ReactElement<{ 'aria-hidden'?: boolean }>;
}

export function ProductButton({
  variant = 'primary',
  busy = false,
  icon,
  className = '',
  disabled,
  children,
  ...props
}: ProductButtonProps) {
  return (
    <button
      {...props}
      className={`product-button product-button--${variant} ${className}`.trim()}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {icon ? (
        <span aria-hidden="true" className="product-button__icon">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}

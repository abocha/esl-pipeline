import { Info } from 'lucide-react';
import React, { useState } from 'react';

export function BusinessInfoHint({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  const [dismissed, setDismissed] = useState(false);
  return (
    <span
      className="business-info"
      onMouseEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setDismissed(true);
      }}
    >
      <button
        type="button"
        className="business-info-trigger"
        aria-label={`About ${label}`}
        aria-describedby={id}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span className="business-info-tooltip" id={id} role="tooltip" hidden={dismissed}>
        {children}
      </span>
    </span>
  );
}

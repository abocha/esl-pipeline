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
  const [pinned, setPinned] = useState(false);
  return (
    <span
      className="business-info"
      onMouseEnter={() => setDismissed(false)}
      onFocus={() => setDismissed(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setDismissed(true);
          setPinned(false);
        }
      }}
    >
      <button
        type="button"
        className="business-info-trigger"
        aria-label={`About ${label}`}
        aria-describedby={id}
        aria-expanded={pinned}
        onClick={() => {
          setDismissed(false);
          setPinned((value) => !value);
        }}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span
        className="business-info-tooltip"
        id={id}
        role="tooltip"
        data-pinned={pinned}
        hidden={dismissed}
      >
        {children}
      </span>
    </span>
  );
}

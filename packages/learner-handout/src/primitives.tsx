import type { ReactNode } from 'react';

import { safeLinkUrl, safeMediaUrl, videoEmbedUrl } from './urls.js';

export function Text({ children }: { children: string }) {
  return <p className="plain-text">{children}</p>;
}

export function Field({ label, children }: { label: string; children: string }) {
  return (
    <p className="plain-text">
      <strong>{label}:</strong> {children}
    </p>
  );
}

export function Disclosure({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={className}>
      <summary>{label}</summary>
      <div className="disclosure-content">{children}</div>
    </details>
  );
}

export function AudioPlayer({ url, label }: { url?: string | null; label: string }) {
  const safe = safeMediaUrl(url);
  return safe ? (
    <figure className="audio-figure">
      <figcaption>{label}</figcaption>
      <audio controls preload="none" src={safe} aria-label={label} />
    </figure>
  ) : (
    <p className="audio-placeholder">{label}: audio unavailable</p>
  );
}

export function SourceLink({ url, children }: { url: string; children?: ReactNode }) {
  const safe = safeLinkUrl(url);
  return safe ? (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children ?? url}
    </a>
  ) : (
    <span>Link unavailable</span>
  );
}

export function SourceVideo({ url }: { url: string }) {
  const embed = videoEmbedUrl(url);
  return embed ? (
    <div className="video-embed">
      <iframe
        title="Source video"
        src={embed}
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  ) : (
    <p>
      <SourceLink url={url}>Open video</SourceLink>
    </p>
  );
}

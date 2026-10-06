import type { ReactNode } from 'react';

import { safeLinkUrl, safeMediaUrl, videoEmbedUrl } from './urls.js';

export function Text({ children, lang }: { children: string; lang?: string }) {
  return (
    <p className="plain-text" lang={lang}>
      {children}
    </p>
  );
}

export function Field({
  label,
  children,
  lang,
}: {
  label: string;
  children: string;
  lang?: string;
}) {
  return (
    <p className="plain-text">
      <strong lang="en">{label}:</strong> {lang ? <span lang={lang}>{children}</span> : children}
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
      <summary lang="en">{label}</summary>
      <div className="disclosure-content">{children}</div>
    </details>
  );
}

export function AudioPlayer({
  url,
  label,
  preview,
}: {
  url?: string | null;
  label: string;
  preview?: boolean;
}) {
  const safe = safeMediaUrl(url);
  return safe ? (
    <figure className="audio-figure">
      <figcaption>{label}</figcaption>
      <audio controls preload="none" src={safe} aria-label={label} />
    </figure>
  ) : (
    <p className="audio-placeholder">
      {preview ? `${label}: Audio track generating...` : `${label}: audio unavailable`}
    </p>
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

import { Check, HelpCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { assignmentInlineParts } from '@esl-pipeline/contracts';

import { safeLinkUrl, safeMediaUrl, videoEmbedUrl } from './urls.js';

// Fixed learner field semantics; ordinary instruction fields keep their text labels.
function markerForLabel(label: string) {
  if (label === 'Wrong') return X;
  if (label === 'Corrected' || label === 'Answer') return Check;
  if (label === 'Explanation') return HelpCircle;
  return null;
}

function FieldLabel({ label }: { label: string }) {
  const Icon = markerForLabel(label);
  return Icon ? (
    <span className={`field-marker field-marker-${label.toLowerCase()}`} lang="en">
      <span className="field-decoration" aria-hidden="true">
        <Icon size={22} strokeWidth={2} focusable="false" />
      </span>
      <strong className="field-label sr-only">{label}:</strong>
    </span>
  ) : (
    <strong className="field-label" lang="en">
      {label}:
    </strong>
  );
}

export function Inline({ children }: { children: string }) {
  const parts = assignmentInlineParts(children);
  const bracketed = (i: number) =>
    parts[i]?.highlighted &&
    !parts[i - 1]?.highlighted &&
    !parts[i + 1]?.highlighted &&
    parts[i - 1]?.text.endsWith('(') &&
    parts[i + 1]?.text.startsWith(')');
  return (
    <span className="inline-text">
      {parts.map((part, i) =>
        part.highlighted ? (
          bracketed(i) ? (
            <span className="bracketed-cue" key={i}>
              (<code className="linguistic-highlight">{part.text}</code>)
            </span>
          ) : (
            <code className="linguistic-highlight" key={i}>
              {part.text}
            </code>
          )
        ) : (
          part.text.slice(bracketed(i - 1) ? 1 : 0, bracketed(i + 1) ? -1 : undefined)
        ),
      )}
    </span>
  );
}

/** Pattern fields are formulas even when their author omitted cue delimiters. */
export function GrammarPattern({ label, children }: { label?: string; children: string }) {
  const rows: { text: string; highlighted: boolean }[][] = [[]];
  for (const part of assignmentInlineParts(children)) {
    if (part.highlighted) {
      rows[rows.length - 1]!.push(part);
      continue;
    }
    // Only unmarked pattern text is split. Explicit cues retain their authored boundaries.
    for (const token of part.text.split(/([,;]|\r\n|\r|\n)/)) {
      const row = rows[rows.length - 1]!;
      if (/^(?:;|\r\n|\r|\n)$/.test(token)) {
        row.push({ text: token, highlighted: false });
        rows.push([]);
      } else if (token === ',' || !token.trim()) {
        row.push({ text: token, highlighted: false });
      } else {
        const [, before, text, after] = token.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
        row.push(
          { text: before!, highlighted: false },
          { text: text!, highlighted: true },
          { text: after!, highlighted: false },
        );
      }
    }
  }
  // Consecutive separators retain their text without creating empty visual rows.
  const lines: typeof rows = [];
  for (const row of rows) {
    if (row.some((part) => part.text.trim()) || !lines.length) lines.push(row);
    else lines[lines.length - 1]!.push(...row);
  }
  return (
    <p className="plain-text grammar-pattern">
      {label && (
        <>
          <strong className="field-label" lang="en">
            {label}:
          </strong>{' '}
        </>
      )}
      <span lang="en" className="pattern-lines">
        {lines.map((row, i) => (
          <span className="pattern-line" key={i}>
            {row.map((part, j) =>
              part.highlighted ? (
                <code className="linguistic-highlight" key={j}>
                  {part.text}
                </code>
              ) : (
                part.text
              ),
            )}
          </span>
        ))}
      </span>
    </p>
  );
}

export function RevealField({
  label,
  children,
  lang,
  name,
}: {
  label: string;
  children: string;
  lang?: string;
  name: string;
}) {
  return (
    <p className={`plain-text grammar-reveal${markerForLabel(label) ? ' semantic-field' : ''}`}>
      <FieldLabel label={label} />{' '}
      <span className="reveal-target">
        <span className="reveal-content" lang={lang} aria-hidden="true">
          <Inline>{children}</Inline>
        </span>
        <button type="button" data-grammar-reveal aria-label={name} lang="en" />
      </span>
    </p>
  );
}

export function Text({
  children,
  lang,
  className,
}: {
  children: string;
  lang?: string;
  className?: string;
}) {
  return (
    <p className={`plain-text${className ? ` ${className}` : ''}`} lang={lang}>
      <Inline>{children}</Inline>
    </p>
  );
}

export function Field({
  label,
  children,
  lang,
  className,
}: {
  label: string;
  children: string;
  lang?: string;
  className?: string;
}) {
  return (
    <p
      className={`plain-text${markerForLabel(label) ? ' semantic-field' : ''}${className ? ` ${className}` : ''}`}
    >
      <FieldLabel label={label} />{' '}
      <span lang={lang} className={markerForLabel(label) ? 'field-value' : undefined}>
        <Inline>{children}</Inline>
      </span>
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
    <details className={className} data-handout-disclosure>
      <summary lang="en">{label}</summary>
      <div className="disclosure-content">
        <div className="disclosure-inner">{children}</div>
      </div>
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

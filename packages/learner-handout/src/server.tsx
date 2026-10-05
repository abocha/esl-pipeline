import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

import { LearnerHandout } from './LearnerHandout.js';
import type { LearnerHandoutProps } from './types.js';

// Package-owned immutable assets, copied once by the package build. No Vite asset loaders.
const css = readFileSync(new URL('./handout.css', import.meta.url), 'utf8');
const playback = readFileSync(new URL('./pronunciation-playback.js', import.meta.url), 'utf8');

/** Complete unhydrated document. No publication identity/version or upload responsibilities. */
export function renderLearnerHandoutDocument(props: LearnerHandoutProps): string {
  return (
    '<!doctype html>' +
    renderToStaticMarkup(
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{props.assignment.metadata.title}</title>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Trusted package CSS, never render input. */}
          <style dangerouslySetInnerHTML={{ __html: css }} />
        </head>
        <body>
          <LearnerHandout {...props} />
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Trusted package behavior, never render input. */}
          <script dangerouslySetInnerHTML={{ __html: playback }} />
        </body>
      </html>,
    )
  );
}

export type { HandoutMediaInputs, LearnerHandoutProps, PronunciationClipInput } from './types.js';
export { safeMediaUrl } from './urls.js';

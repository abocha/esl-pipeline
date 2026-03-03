# Changelog

## 0.1.1

### Patch Changes

- Fixed pronunciation shadow-sentence rendering regressions in generated/preview HTML:
  - preserve theme toggle/play-button behavior script compatibility.
  - normalize LLM-variant pronunciation markup for clean rich-text output.
  - keep generated audio placeholder markers out of visible HTML.
  - improve pronunciation audio anchor placement below the shadow sentence context.
- Updated inline backtick preprocessing:
  - render single-backtick snippets as `<code>` while allowing rich inner Markdown formatting.
  - preserve valid multi-backtick inline code spans.
- Hardened URL/media rendering behavior:
  - preserve safe relative `href`/`src` paths instead of degrading them to `#`.
  - continue blocking unsafe URL schemes in generated HTML.
  - normalize known YouTube/Vimeo directive variants to canonical embed URLs.
  - recognize audio links with fragment timestamps (for example `#t=10`) as audio players.

## 0.1.0

- Initial extraction from `@esl-pipeline/anytype-adapter`.

# Changelog

## 0.1.1

### Patch Changes

- Fixed pronunciation shadow-sentence rendering regressions in generated/preview HTML:
  - preserve theme toggle/play-button behavior script compatibility.
  - normalize LLM-variant pronunciation markup for clean rich-text output.
  - keep generated audio placeholder markers out of visible HTML.
  - improve pronunciation audio anchor placement below the shadow sentence context.
- Updated inline backtick preprocessing:
  - unwrap single-backtick snippets as regular Markdown text.
  - preserve valid multi-backtick inline code spans.

## 0.1.0

- Initial extraction from `@esl-pipeline/anytype-adapter`.

# @esl-pipeline/html-publisher

Native AssignmentV1 HTML rendering and publication.

## Exports

- `renderAssignmentToHtml(assignment, options)`: typed handout with escaped plain fields,
  a responsive shell, safe media, and explicit pronunciation controls.
- `renderAndPublishAssignmentToS3({ assignment, ...options })`: typed publication.
- `publishHtmlToS3(html, options)`: upload already-rendered HTML.
- `ASSIGNMENT_HTML_RENDERER_VERSION`: `2`.
- `RenderOptions`, `FeatureFlags`, and `ThemeTokens`: shared typed presentation options.

Historical Markdown assignments are read-only records. This package has no Markdown rendering,
normalization, parsing, or publication API. Already-produced historical HTML and audio remain
available through persisted URLs; they are never scraped or regenerated.

## URL and media safety

Links and media reject unsafe URL schemes. Typed video fields support YouTube and Vimeo embeds.
Pronunciation playback binds explicit clip IDs from typed rendering to serialized audio metadata.

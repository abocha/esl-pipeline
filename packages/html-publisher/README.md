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

The native handout has no table of contents. Mission key language is itemized, study audio precedes
the collapsed transcript, and grammar traps separate wrong, corrected and explanation text without
adding sentence punctuation. Generated source titles use compact captions (exact duplicates of the
assignment title/topic are omitted); authentic titles, attribution and source links remain visible.
The practice heading reflects pronunciation presence. The collapsed answer key follows comprehension,
matching practice parts and sample mission order, repeating each question with its labeled answer
and optional explanation. These presentation choices retain renderer version 2 and canonical identity.

## URL and media safety

Links and media reject unsafe URL schemes. Typed video fields support YouTube and Vimeo embeds.
Pronunciation playback binds explicit clip IDs from typed rendering to serialized audio metadata.

## React transition foundation (ESL-22)

[`learner-handout`](../learner-handout/README.md) owns the new isolated React component surface,
Vite fixture loop and deterministic Node static document entry. It has no production caller yet.
This package remains the production rendering/publication authority with the existing renderer 2
and unchanged publication identity. A later adapter can consume the React document renderer while
retaining publication versioning and upload ownership here.

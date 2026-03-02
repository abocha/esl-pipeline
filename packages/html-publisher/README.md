# @esl-pipeline/html-publisher

Shared HTML renderer/publisher used by multiple publish targets (direct `html` and Anytype export path).

## Exports

- `renderToHtml(markdown, title, options)`
- `createStaticPageHtml(markdown, title, options)`
- `publishHtmlToS3(html, options)`
- `renderAndPublishMarkdownToS3({ markdown, title, ...options })`

## Markdown Preprocessing Notes

- Single-backtick inline snippets are normalized as regular Markdown text before rendering. This allows
  patterns like `` `**Bold cue:** *slowly*` `` to render as rich formatting instead of `<code>`.
- Multi-backtick inline code spans are preserved as code (for example `` ``a`` `` and `` ``a `b` c`` ``).
- Fenced code blocks remain untouched by preprocessing.
- Pronunciation micro-focus content receives additional normalization to clean LLM-variant bullet/code wrappers.

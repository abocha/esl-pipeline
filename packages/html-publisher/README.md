# @esl-pipeline/html-publisher

Shared HTML renderer/publisher used by multiple publish targets (direct `html` and Anytype export path).

## Exports

- `renderToHtml(markdown, title, options)`
- `createStaticPageHtml(markdown, title, options)`
- `publishHtmlToS3(html, options)`
- `renderAndPublishMarkdownToS3({ markdown, title, ...options })`

## Markdown Preprocessing Notes

- Single-backtick inline snippets render as `<code>` and can include rich inline Markdown formatting
  (for example `` `**Bold cue:** *slowly*` ``).
- Multi-backtick inline code spans are preserved as literal code (for example `` ``a`` `` and
  `` ``a `b` c`` ``).
- Fenced code blocks remain untouched by preprocessing.
- Pronunciation micro-focus content receives additional normalization to clean LLM-variant bullet/code wrappers.

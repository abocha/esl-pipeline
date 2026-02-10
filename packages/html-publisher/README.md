# @esl-pipeline/html-publisher

Shared HTML renderer/publisher used by multiple publish targets (direct `html` and Anytype export path).

## Exports

- `renderToHtml(markdown, title, options)`
- `createStaticPageHtml(markdown, title, options)`
- `publishHtmlToS3(html, options)`
- `renderAndPublishMarkdownToS3({ markdown, title, ...options })`

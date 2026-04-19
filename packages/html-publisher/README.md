# @esl-pipeline/html-publisher

Shared HTML renderer/publisher for the pipeline's html-only publish path.

## Exports

- `renderToHtml(markdown, title, options)`
- `createStaticPageHtml(markdown, title, options)`
- `publishHtmlToS3(html, options)`
- `renderAndPublishMarkdownToS3({ markdown, title, ...options })`

## Markdown Preprocessing Notes

- Single-backtick inline snippets render as `<code>` and can include rich inline Markdown formatting
  (for example `` `**Bold cue:** *slowly*` ``).
- Multi-backtick inline code spans are preserved as literal code (for example ` `a` ` and
  ` `a `b` c` `).
- Fenced code blocks remain untouched by preprocessing.
- Pronunciation micro-focus content receives additional normalization to clean LLM-variant bullet/code wrappers.

## URL and Media Safety

- `href` and `src` values are sanitized to block unsafe schemes (for example `javascript:`).
- Safe relative URLs are preserved, including:
  - root-relative (`/assets/file.png`)
  - dot-relative (`./file.md`, `../audio/clip.mp3`)
  - bare relative paths (`lesson-2.md`, `images/pic.png`)
- `:::video` URLs are normalized for known variants:
  - YouTube `watch`, `youtu.be`, `embed`, and `shorts` forms map to `youtube.com/embed/<id>`.
  - Vimeo direct, `video`, `channels`, `groups/.../videos/...`, and `album/.../video/...` forms map to `player.vimeo.com/video/<id>`.

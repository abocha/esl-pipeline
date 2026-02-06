# @esl-pipeline/anytype-adapter

Anytype adapter for the ESL Pipeline. It can create/update Anytype objects and render assignment markdown to a styled HTML page for student delivery.

## Environment

The Anytype Desktop app must be running.

- `ANYTYPE_API_URL` (default: `http://localhost:31009/v1`)
- `ANYTYPE_TOKEN` (required)
- `ANYTYPE_API_VERSION` (default: `2025-11-08`)

## Preview HTML Output

Generate a local HTML preview (no Anytype/S3 required):

```bash
pnpm --filter @esl-pipeline/anytype-adapter preview -- --md fixtures/actual_file.md
```

Default output path:

```
tmp/anytype-preview.html (relative to the repo)
```

Override output path or title:

```bash
pnpm --filter @esl-pipeline/anytype-adapter preview -- --md fixtures/actual_file.md --out tmp/anytype-preview.html --title "Preview"
```

Useful preview flags:

- `--raw-html`
- `--hide-date`
- `--sticky-toc`
- `--no-sticky-toc`
- `--no-copy-code`

## Published HTML Defaults

The renderer now defaults to:

- safer output (`allowRawHtml: false`)
- generated date tag shown in the header (`showGeneratedDate: true`)
- non-sticky, collapsible ToC by default, with code copy buttons enabled

When sharing to S3, you can override these in `sharePageToS3` options:

- `allowRawHtml`
- `showGeneratedDate`
- `features` (`stickyToc`, `copyCode`)
- `theme` (full color tokens)
- `headingTheme` (legacy heading colors only)

## Frontmatter Support

The renderer reads these frontmatter keys when present:

- `title` → page title
- `icon` → emoji displayed above the title
- `student` → rendered as a tag
- `topic` → rendered as a tag

If `title` is missing, the renderer uses `Untitled`.

# @esl-pipeline/notion-importer

Import markdown lesson files to Notion with advanced formatting support.

## Features

- **Page Customization**: Set icons and cover images
- **Rich Layouts**: Callouts, multi-column layouts, table of contents
- **Media Embeds**: Audio and video from external URLs
- **Toggle Headings**: Collapsible headings at multiple levels (H1, H2, H3)
- **Synced Blocks**: Reusable content across pages
- **Custom Properties**: Add arbitrary properties to Notion pages
- **Topic Normalization**: Handles comma-separated topics correctly

## Installation

```bash
pnpm install
```

## Usage

### Basic Import

```bash
npx notion-importer path/to/lesson.md --db "Homework Database"
```

### With Options

```bash
npx notion-importer lesson.md \
  --db "Homework Database" \
  --student "Anna" \
  --dry-run
```

## Markdown Format

### Frontmatter

```yaml
---
title: 'Lesson Title'
student: Anna
level: B1
topic: 'Grammar, Second Conditional' # Use quotes for topics with commas
input_type: generate
speaker_labels: [Anna, Teacher]

# Optional advanced fields
icon: 🎯
cover: https://example.com/cover.jpg
properties:
  Status: 'In Progress'
  Difficulty: 'Intermediate'
---
```

### Custom Directives

**Callouts:**

```markdown
:::callout 💡
Important information here
:::
```

**Columns:**

```markdown
:::column-list
:::column
Left content
:::
:::column
Right content
:::
:::
```

**Toggle Headings:**

```markdown
:::toggle-h2 Answer Key
Hidden content
:::
```

**Media:**

```markdown
:::audio https://example.com/audio.mp3
:::video https://youtube.com/watch?v=abc123
```

**Table of Contents:**

```markdown
:::toc
```

See [`NOTION_FEATURES_GUIDE.md`](../../NOTION_FEATURES_GUIDE.md) for complete documentation.

## API

```typescript
import { runImport } from '@esl-pipeline/notion-importer';

const result = await runImport({
  mdPath: './lesson.md',
  dbId: 'database-id',
  student: 'Anna',
  dryRun: false,
});

console.log(result.page_id, result.url);
```

## Version 2.0 Changes

- Added support for advanced Notion features (callouts, columns, etc.)
- Fixed topic handling (arrays now auto-normalized to single string)
- Changed Topic property from `multi_select` to `rich_text`
- Added page icon and cover support
- Added custom properties support

## Testing

```bash
pnpm test
```

## License

UNLICENSED

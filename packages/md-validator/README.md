# @esl-pipeline/md-validator

Validate ESL homework markdown files for correct structure and formatting before import.

## Features

- **Frontmatter Validation**: Ensures required fields are present and valid
- **Structure Validation**: Checks for all 9 required H2 sections
- **Marker Validation**: Validates `study-text`, Answer Key, and Teacher's Plan blocks
- **Dialogue Validation**: Enforces speaker label rules for dialogue mode
- **Advanced Field Support**: Validates icons (emoji), cover URLs, and custom properties
- **Topic Normalization**: Auto-fixes comma-separated topics (joins arrays)

## Installation

```bash
pnpm install
```

## Usage

### CLI

```bash
# Validate a file
npx md-validator path/to/lesson.md

# Strict mode (warnings become errors)
npx md-validator --strict lesson.md
```

### API

```typescript
import { validateMarkdownFile } from '@esl-pipeline/md-validator';

const result = await validateMarkdownFile('./lesson.md', { strict: true });

if (!result.ok) {
  console.error('Validation failed:');
  result.errors.forEach((err) => console.error(`  - ${err}`));
  result.warnings.forEach((warn) => console.warn(`  - ${warn}`));
}
```

## Validation Rules

### Required Frontmatter Fields

```yaml
title: string (non-empty)
student: string (non-empty)
level: string (non-empty)
topic: string (non-empty)
input_type: string (non-empty)
```

### Optional Frontmatter Fields

```yaml
speaker_labels: string[]
icon: emoji (single character)
cover: URL
properties: object
speaker_profiles: any[]
```

### Required Structure

- 9 H2 sections in specific order
- `:::study-text ... :::` block
- `:::toggle-heading Answer Key` or `:::toggle-h2 Answer Key`
- `:::toggle-heading Teacher's Follow-up Plan` or `:::toggle-h2/h3 Teacher's Follow-up Plan`

### Content Rules

- **Dialogue mode**: If `speaker_labels` contains multiple speakers (not just "Narrator"), all lines in `study-text` must follow `Speaker: text` format
- **Monologue mode**: At least 3 paragraphs or 10 lines in `study-text`
- **Controlled Practice**: 8-10 items recommended
- **Comprehension Check**: 2-3 items recommended

## Version 2.0 Changes

- Added validation for `icon` (emoji), `cover` (URL), and `properties` fields
- Added toggle-heading syntax support (`:::toggle-h2`, `:::toggle-h3`)
- Fixed apostrophe matching in "Teacher's Follow-up Plan" (supports `'`, `'`, `'`)
- Added topic normalization (arrays auto-converted to comma-separated strings)

## Testing

```bash
pnpm test
```

## License

UNLICENSED

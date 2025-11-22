# @esl-pipeline/md-extractor

Extract structured data from ESL homework markdown files.

## Features

- **Frontmatter Extraction**: Parse YAML frontmatter
- **Study Text Extraction**: Get the main lesson dialogue/monologue
- **Section Extraction**: Extract H2/H3 sections with content
- **Answer Key Extraction**: Get Answer Key toggle content
- **Teacher Notes Extraction**: Get Teacher's Follow-up Plan content
- **Toggle Syntax Support**: Works with both `:::toggle-heading` and `:::toggle-h2/h3`

## Installation

```bash
pnpm install
```

## Usage

```typescript
import {
  extractAnswerKey,
  extractFrontmatter,
  extractSections,
  extractStudyText,
  extractTeacherNotes,
} from '@esl-pipeline/md-extractor';

const md = await fs.readFile('lesson.md', 'utf8');

// Extract frontmatter
const fm = extractFrontmatter(md);
console.log(fm.title, fm.student, fm.level, fm.topic);

// Extract study text
const study = extractStudyText(md);
console.log(study.type); // 'dialogue' | 'monologue'
console.log(study.lines);

// Extract sections
const sections = extractSections(md);
sections.forEach((section) => {
  console.log(section.depth, section.title, section.content);
});

// Extract specific blocks
const answers = extractAnswerKey(md);
const teacherNotes = extractTeacherNotes(md);
```

## API

### `extractFrontmatter(md: string): Frontmatter`

Returns parsed YAML frontmatter.

### `extractStudyText(md: string): StudyText`

Returns:

```typescript
{
  type: 'dialogue' | 'monologue',
  lines: string[]  // Trimmed, non-empty lines
}
```

Detects dialogue if 2+ lines match `Speaker: text` format.

### `extractAnswerKey(md: string): string`

Extracts content from:

- `:::toggle-heading Answer Key` (legacy)
- `:::toggle-h2 Answer Key` (new)

### `extractTeacherNotes(md: string): string`

Extracts content from:

- `:::toggle-heading Teacher's Follow-up Plan` (legacy)
- `:::toggle-h2 Teacher's Follow-up Plan` (new)
- `:::toggle-h3 Teacher's Follow-up Plan` (new)

### `extractSections(md: string): Section[]`

Returns array of:

```typescript
{
  depth: 2 | 3,
  title: string,
  content: string  // Everything until next heading of same/higher level
}
```

## Version 2.0 Changes

- Added support for new toggle-heading syntax (`:::toggle-h2`, `:::toggle-h3`)
- Fixed apostrophe matching (supports `'`, `'`, `'`)
- Maintains backward compatibility with `:::toggle-heading`

## Use Cases

- **TTS Generation**: Extract `study-text` for speech synthesis
- **Content Analysis**: Parse sections for automated review
- **Data Processing**: Extract metadata for batch operations
- **Testing**: Verify markdown structure programmatically

## Testing

```bash
pnpm test
```

## License

UNLICENSED

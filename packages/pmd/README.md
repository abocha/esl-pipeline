# @esl-pipeline/pmd

Parse Pipeline Markdown (PMD) into a stable AST and extract study metadata for the pipeline.

## Features

- PMD AST parsing (`parsePmdDocument`)
- Directive queries (`findDirectiveBlocks`)
- Extraction helpers:
  - `extractFrontmatter`
  - `extractStudyText`
  - `extractAnswerKey`
  - `extractTeacherNotes`
  - `extractSections`

## CLI

The `md-extractor` CLI is now provided by this package:

```bash
md-extractor --md path/to/lesson.md --what frontmatter
```

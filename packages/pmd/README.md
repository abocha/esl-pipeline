# @esl-pipeline/pmd

Parse Pipeline Markdown (PMD) into a stable AST and extract study metadata for the pipeline.

Assignments rendered from `AssignmentV1` carry `assignment_projection: assignment_v1` in
frontmatter. Only that projection decodes numeric prose escapes after structural parsing and
admits pronunciation word/pair entries without transcription (projected as an empty transcription).
Historical Markdown extraction and validation rules retain their previous behavior.

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

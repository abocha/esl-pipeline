# @esl-pipeline/notion-importer

## 2.2.0

### Minor Changes

- removed minio support, set aws s3 as default, else filesystem

## 2.1.3

### Patch Changes

- Notion colorizer/importer/tts: relaxed Notion/ElevenLabs typings with casts/ts-nocheck and fixed minor type errors to restore builds.

## 2.1.2

### Patch Changes

- Updated dependencies
  - @esl-pipeline/md-validator@2.0.3

## 2.1.1

### Patch Changes

- set up proper vitest eslint; set up proper typescript cli typechecking; small fixes in tess; bug: some files could not be chosen manually by the interactive wizard, now fixed; updated deps.
- Updated dependencies
  - @esl-pipeline/md-extractor@2.0.2
  - @esl-pipeline/md-validator@2.0.2
  - @esl-pipeline/contracts@1.0.1

## 2.1.0

### Minor Changes

- almost full rewrite of mdToBlocks to match advansed formatting directives in Notion API

### Patch Changes

- Updated dependencies
  - @esl-pipeline/md-extractor@2.0.1
  - @esl-pipeline/md-validator@2.0.1

## 2.0.0

### Major Changes

- Large format and lint edit, bring to modern standards & much more robust typing; several large refactors removing duplicate code; many bugs fixed; unnecessary deps removed
- **Advanced Notion Features**: Added support for page icons, cover images, callouts, column layouts, table of contents, audio/video embeds, toggle headings (h1/h2/h3), and synced blocks
- **Custom Properties**: Added support for arbitrary properties via frontmatter `properties` field
- **Topic Normalization**: Fixed topic handling - arrays (from unquoted YAML with commas) are now auto-joined into single strings; changed Topic property from `multi_select` to `rich_text`
- **Frontmatter Extensions**: Added `icon`, `cover`, and `properties` fields to frontmatter
- **Directive Parsing**: Implemented comprehensive parsing for `:::callout`, `:::column-list`, `:::toc`, `:::audio`, `:::video`, `:::toggle-h1/h2/h3`, and `:::synced-block`
- **Breaking Change**: Topic is now always a single text value, not an array of tags

### Patch Changes

- Updated dependencies
  - @esl-pipeline/md-extractor@2.0.0
  - @esl-pipeline/md-validator@2.0.0
  - @esl-pipeline/contracts@1.0.0

## 1.2.4

### Patch Changes

- refactor p5&6 and many issues from REVIEW.md
- Updated dependencies
  - @esl-pipeline/md-extractor@1.4.3
  - @esl-pipeline/md-validator@1.5.3
  - @esl-pipeline/contracts@0.1.2

## 1.2.3

### Patch Changes

- optimized dependancies
- Updated dependencies
  - @esl-pipeline/md-extractor@1.4.2
  - @esl-pipeline/md-validator@1.5.2

## 1.2.2

### Patch Changes

- feat: add .mp3 title; add .mp3 student name in filename; known bug: wizard not loading TTS defaults; chore: deps up
- Updated dependencies
  - @esl-pipeline/md-extractor@1.4.1
  - @esl-pipeline/md-validator@1.5.1

## 1.2.1

### Patch Changes

- Updated dependencies [83f0d6e]
  - @esl-pipeline/md-validator@1.5.0

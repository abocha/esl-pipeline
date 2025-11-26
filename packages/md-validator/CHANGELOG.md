# @esl-pipeline/md-validator

## 2.0.2

### Patch Changes

- set up proper vitest eslint; set up proper typescript cli typechecking; small fixes in tess; bug: some files could not be chosen manually by the interactive wizard, now fixed; updated deps.
- Updated dependencies
  - @esl-pipeline/contracts@1.0.1

## 2.0.1

### Patch Changes

- almost full rewrite of mdToBlocks to match advansed formatting directives in Notion API

## 2.0.0

### Major Changes

- Large format and lint edit, bring to modern standards & much more robust typing; several large refactors removing duplicate code; many bugs fixed; unnecessary deps removed
- **Frontmatter Validation**: Added validation for `icon` (emoji), `cover` (URL), and `properties` (object) fields
- **Toggle Syntax Support**: Updated marker detection to accept both `:::toggle-heading` and `:::toggle-h2/h3` syntax for Answer Key and Teacher's Follow-up Plan
- **Topic Normalization**: Added preprocessing to auto-join topic arrays into comma-separated strings before validation
- **Apostrophe Fix**: Fixed Teacher's Follow-up Plan regex to match all apostrophe variants (U+0027, U+2018, U+2019) using Unicode escapes
- **Schema Update**: Changed `topic` from `string | string[]` to just `string` (arrays normalized before validation)

### Patch Changes

- Updated dependencies
  - @esl-pipeline/contracts@1.0.0

## 1.5.3

### Patch Changes

- refactor p5&6 and many issues from REVIEW.md
- Updated dependencies
  - @esl-pipeline/contracts@0.1.2

## 1.5.2

### Patch Changes

- optimized dependancies

## 1.5.1

### Patch Changes

- feat: add .mp3 title; add .mp3 student name in filename; known bug: wizard not loading TTS defaults; chore: deps up

## 1.5.0

### Minor Changes

- 83f0d6e: add types of content to validator study-text; tts-elevenlabs now checks speakers in study-text correctly

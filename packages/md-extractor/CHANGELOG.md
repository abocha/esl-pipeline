# @esl-pipeline/md-extractor

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
- **Toggle Syntax Support**: Updated `extractAnswerKey()` and `extractTeacherNotes()` to accept both legacy `:::toggle-heading` and new `:::toggle-h2/h3` syntax
- **Apostrophe Fix**: Fixed Teacher's Follow-up Plan regex to match all apostrophe variants (U+0027, U+2018, U+2019) using Unicode escapes
- **Backward Compatibility**: Maintained full compatibility with existing markdown files while adding support for new toggle heading levels

### Patch Changes

- Updated dependencies
  - @esl-pipeline/contracts@1.0.0

## 1.4.3

### Patch Changes

- refactor p5&6 and many issues from REVIEW.md
- Updated dependencies
  - @esl-pipeline/contracts@0.1.2

## 1.4.2

### Patch Changes

- optimized dependancies

## 1.4.1

### Patch Changes

- feat: add .mp3 title; add .mp3 student name in filename; known bug: wizard not loading TTS defaults; chore: deps up

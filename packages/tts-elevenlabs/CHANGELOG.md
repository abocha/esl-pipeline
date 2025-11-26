# @esl-pipeline/tts-elevenlabs

## 3.0.4

### Patch Changes

- Notion colorizer/importer/tts: relaxed Notion/ElevenLabs typings with casts/ts-nocheck and fixed minor type errors to restore builds.

## 3.0.3

### Patch Changes

- set up proper vitest eslint; set up proper typescript cli typechecking; small fixes in tess; bug: some files could not be chosen manually by the interactive wizard, now fixed; updated deps.
- Updated dependencies
  - @esl-pipeline/md-extractor@2.0.2
  - @esl-pipeline/contracts@1.0.1

## 3.0.2

### Patch Changes

- almost full rewrite of mdToBlocks to match advansed formatting directives in Notion API
- Updated dependencies
  - @esl-pipeline/md-extractor@2.0.1

## 3.0.1

### Patch Changes

- fix prepend and metadata bug

## 3.0.0

### Major Changes

- large format and lint edit, bring to modern standarts & much much more robust typing; several large refactors removing duplicate code; many bugs fixed; unnecessary deps removed

### Patch Changes

- Updated dependencies
  - @esl-pipeline/md-extractor@2.0.0
  - @esl-pipeline/contracts@1.0.0

## 2.0.2

### Patch Changes

- refactor p5&6 and many issues from REVIEW.md
- Updated dependencies
  - @esl-pipeline/md-extractor@1.4.3
  - @esl-pipeline/contracts@0.1.2

## 2.0.1

### Patch Changes

- optimized dependancies
- Updated dependencies
  - @esl-pipeline/md-extractor@1.4.2

## 2.0.0

### Major Changes

- elevenlabs eleven_v3 model support in tts and automatic detection of dialogue or monologue mode in study text. all working in the interactive wizard

## 1.6.0

### Minor Changes

- feat: add .mp3 title; add .mp3 student name in filename; known bug: wizard not loading TTS defaults; chore: deps up

### Patch Changes

- Updated dependencies
  - @esl-pipeline/md-extractor@1.4.1

## 1.5.0

### Minor Changes

- 83f0d6e: add types of content to validator study-text; tts-elevenlabs now checks speakers in study-text correctly

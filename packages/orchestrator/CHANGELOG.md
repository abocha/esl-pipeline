# @esl-pipeline/orchestrator

## 3.3.2

### Patch Changes

- chore: 2.1.0 release version bump.


## 3.3.1

### Patch Changes

- Updated dependencies
  - @esl-pipeline/notion-adapter@0.2.0

## 3.3.0

### Minor Changes

- chore: milestone alpha3 version bumps

### Patch Changes

- Updated dependencies
  - @esl-pipeline/shared-infrastructure@1.1.5

## 3.2.3

### Patch Changes

- @esl-pipeline/shared-infrastructure@1.1.4

## 3.2.2

### Patch Changes

- @esl-pipeline/shared-infrastructure@1.1.3

## 3.2.1

### Patch Changes

- update deps
- Updated dependencies
  - @esl-pipeline/shared-infrastructure@1.1.2

## 3.2.0

### Minor Changes

- feat(tts): strict gender voice picking + ttsStrategy naming, debug-gated logs, and type-safety fixes

### Patch Changes

- @esl-pipeline/shared-infrastructure@1.1.1

## 3.1.0

### Minor Changes

- removed minio support, set aws s3 as default, else filesystem

### Patch Changes

- Updated dependencies
  - @esl-pipeline/shared-infrastructure@1.1.0

## 3.0.4

### Patch Changes

- env fallback for job options.

## 3.0.3

### Patch Changes

- readme update & prune abandoned scripts

## 3.0.2

### Patch Changes

- set up proper vitest eslint; set up proper typescript cli typechecking; small fixes in tess; bug: some files could not be chosen manually by the interactive wizard, now fixed; updated deps.
- Updated dependencies
  - @esl-pipeline/shared-infrastructure@1.0.1

## 3.0.1

### Patch Changes

- almost full rewrite of mdToBlocks to match advansed formatting directives in Notion API

## 3.0.0

### Major Changes

- large format and lint edit, bring to modern standarts & much much more robust typing; several large refactors removing duplicate code; many bugs fixed; unnecessary deps removed

### Patch Changes

- Updated dependencies
  - @esl-pipeline/shared-infrastructure@1.0.0

## 2.0.2

### Patch Changes

- refactor p5&6 and many issues from REVIEW.md
- Updated dependencies
  - @esl-pipeline/shared-infrastructure@0.1.1

## 2.0.1

### Patch Changes

- optimized dependancies

## 2.0.0

### Major Changes

- ElevenLabs `eleven_v3` support + automatic selection of `dialogue` vs `tts` strategy from study text (wired through the interactive wizard)

## 1.7.3

### Patch Changes

- fix: wizard now correctly loads TTS defaults

## 1.7.2

### Patch Changes

- feat: add .mp3 title; add .mp3 student name in filename; known bug: wizard not loading TTS defaults; chore: deps up

# Error Handling Standardization

## Overview

This document details the work done to standardize error handling across the ESL Pipeline CLI and Backend. The goal was to introduce shared error classes in `@esl-pipeline/contracts` and update all packages to use them, addressing issue 5.6.2 in `REVIEW.md`.

## Changes

### Shared Contracts

Created `packages/contracts/src/errors.ts` with the following error classes:

- `PipelineError`: Base class for all pipeline errors.
- `ConfigurationError`: For missing configuration files or invalid settings.
- `InfrastructureError`: For system-level issues (e.g., missing binaries, file access).
- `FfmpegNotFoundError`: Specific infrastructure error for missing FFmpeg.
- `ValidationError`: For invalid user input or data (e.g., markdown validation).
- `ManifestError`: For missing or invalid manifest data.

### Package Updates

#### `tts-elevenlabs`

- Now depends on `@esl-pipeline/contracts`.
- Uses `FfmpegNotFoundError` from contracts instead of a local definition.
- Exports `FfmpegNotFoundError` for consumers.

#### `notion-importer`

- Now depends on `@esl-pipeline/contracts`.
- Throws `ValidationError` instead of generic `Error` for markdown validation failures.

#### `storage-uploader`

- Now depends on `@esl-pipeline/contracts`.
- Throws `ConfigurationError` for missing S3 bucket or unsupported backend.

#### `orchestrator`

- Uses `ConfigurationError` in `pipeline.ts` for missing config files.
- Uses `ValidationError`, `ManifestError`, and `InfrastructureError` in `index.ts` for various failure conditions.

#### `batch-backend`

- Updates `pipeline-worker-entry.ts` to catch `PipelineError` and log specific details (name, stack) for better debugging.

#### `md-extractor`

- Replaced generic `Error` with `ValidationError` for missing study-text, answer key, and teacher notes.

#### `md-validator`

- Replaced generic `Error` with `ValidationError` for missing code block.

#### `notion-add-audio`

- Replaced generic `Error` with `ConfigurationError` for missing token.
- Replaced generic `Error` with `ValidationError` for missing pageId/url and missing study-text toggle.

#### `notion-colorizer`

- Replaced generic `Error` with `ConfigurationError` for missing token, missing preset, and invalid preset.

#### `shared-infrastructure`

- Replaced generic `Error` with `ConfigurationError` for incomplete S3/MinIO config and missing manifest bucket.

## Verification Results

### Automated Tests

- Ran `pnpm build` successfully.
- Verified that all packages (`md-extractor`, `md-validator`, `notion-add-audio`, `notion-colorizer`, `shared-infrastructure`, `orchestrator`, `batch-backend`, `storage-uploader`, `notion-importer`, `tts-elevenlabs`) compile correctly with the new error classes.

### Manual Verification

- Confirmed that `ConfigurationError`, `ValidationError`, `ManifestError`, and `InfrastructureError` are correctly imported and used in the respective packages.
- Verified that `PipelineError` is the base class for all shared errors.

## Additional Standardization (2025-11-21)

This section documents additional error handling standardization work completed to ensure all generic `Error` throws are replaced with specific error classes.

### Changes Made

#### [shared-infrastructure/src/storage/config.ts](file:///home/abocha/code/esl-pipeline/packages/shared-infrastructure/src/storage/config.ts)

- **Line 72**: Replaced `throw new Error(...)` with `throw new ConfigurationError(...)` for S3/MinIO incomplete configuration validation.

#### [storage-uploader/src/s3.ts](file:///home/abocha/code/esl-pipeline/packages/storage-uploader/src/s3.ts)

- **Line 4**: Added `import { ConfigurationError } from '@esl-pipeline/contracts'`.
- **Line 27**: Replaced `throw new Error('S3 bucket not configured')` with `throw new ConfigurationError('S3 bucket not configured')`.

#### [notion-importer/src/index.ts](file:///home/abocha/code/esl-pipeline/packages/notion-importer/src/index.ts)

- **Line 11**: Added `import { ValidationError } from '@esl-pipeline/contracts'`.
- **Line 21**: Replaced `throw new Error(msg)` with `throw new ValidationError(msg)` for markdown validation failures.
- **Line 27**: Replaced `throw new Error(...)` with `throw new ValidationError(...)` for missing code block.

#### [notion-colorizer/src/retry.ts](file:///home/abocha/code/esl-pipeline/packages/notion-colorizer/src/retry.ts)

- **Line 1**: Added `import { InfrastructureError } from '@esl-pipeline/contracts'`.
- **Line 27**: Replaced `throw new Error(...)` with `throw new InfrastructureError(...)` for retry exhaustion.

#### [notion-add-audio/src/index.ts](file:///home/abocha/code/esl-pipeline/packages/notion-add-audio/src/index.ts)

- **Line 2**: Updated imports to include `InfrastructureError`.
- **Line 35**: Replaced `throw new Error(...)` with `throw new InfrastructureError(...)` for retry exhaustion.

#### [tts-elevenlabs/src/index.ts](file:///home/abocha/code/esl-pipeline/packages/tts-elevenlabs/src/index.ts)

- **Line 21**: Added `import { ConfigurationError, ValidationError, InfrastructureError } from '@esl-pipeline/contracts'`.
- **Line 89**: Replaced `throw new Error(...)` with `throw new ConfigurationError(...)` for missing voice mapping.
- **Line 266**: Replaced `throw new Error(...)` with `throw new ConfigurationError(...)` for unresolved voice.
- **Line 288**: Replaced `throw new Error(...)` with `throw new ValidationError(...)` for zero TTS segments.
- **Line 539**: Replaced synthesis error wrapping to use `InfrastructureError` instead of generic `Error`.

#### [orchestrator/src/pipeline.ts](file:///home/abocha/code/esl-pipeline/packages/orchestrator/src/pipeline.ts)

- **Line 80**: Replaced `throw new Error(...)` with `throw new ConfigurationError(...)` for missing `presets.json`.
- **Line 93**: Replaced `throw new Error(...)` with `throw new ConfigurationError(...)` for missing `voices.yml`.
- **Line 106**: Replaced `throw new Error(...)` with `throw new ConfigurationError(...)` for missing students directory.
- **Line 259**: Replaced `throw new Error(...)` with `throw new ConfigurationError(...)` for missing config endpoint.

#### [batch-backend/tests/infrastructure.orchestrator-service.test.ts](file:///home/abocha/code/esl-pipeline/packages/batch-backend/tests/infrastructure.orchestrator-service.test.ts)

- **Lines 32-41**: Added `resolveConfigPaths` mock to fix test failures caused by the orchestrator importing the function.

### Test Results

- **Build**: ✅ All packages build successfully
- **Tests**: 151/154 passing (3 pre-existing failures in batch-backend worker process tests unrelated to error handling changes)

The 3 remaining test failures in `batch-backend` are related to worker process integration tests that spawn real child processes and attempt to run the actual pipeline. These failures are environmental (missing config files in test environment) and were not introduced by the error handling standardization work.

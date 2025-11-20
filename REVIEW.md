# Code Review: ESL Pipeline

## 1. Overview

The `esl-pipeline` is a monorepo designed to automate the processing of ESL (English as a Second Language) assignments. It takes Markdown files as input and performs a series of operations: validation, extraction, Notion import, text-to-speech (TTS) generation, and audio upload.

The project is well-structured using `pnpm` workspaces and follows a clear separation of concerns. The `orchestrator` package acts as the central hub, coordinating the execution of other specialized packages.

## 2. Project Structure

The monorepo layout is logical and modular:

-   **`packages/orchestrator`**: The core logic, CLI, and API. It defines the pipeline stages and manages data flow.
-   **`packages/md-validator`**: Responsible for validating the input Markdown files.
-   **`packages/md-extractor`**: Extracts study text and metadata from the Markdown.
-   **`packages/notion-importer`**: Handles the creation and updating of Notion pages.
-   **`packages/tts-elevenlabs`**: Integrates with ElevenLabs for TTS generation.
-   **`packages/storage-uploader`**: Manages file uploads (e.g., to S3).
-   **`configs`**: Contains configuration files for presets, voices, and students.

## 3. Key Components Analysis

### 3.1. Orchestrator

-   **CLI & API**: The orchestrator provides both a CLI (`esl`) and a programmatic API (`createPipeline`). This is a good design choice, allowing for flexible usage.
-   **Pipeline Stages**: The pipeline is defined as a sequence of stages (`validate`, `import`, `colorize`, `tts`, `upload`, `add-audio`, `manifest`). This makes the flow easy to understand and debug.
-   **Adapters**: The use of adapters for `ManifestStore` and `ConfigProvider` promotes extensibility and testability.
-   **Observability**: The `PipelineLogger` and `PipelineMetrics` interfaces allow for pluggable logging and metrics collection.

### 3.2. TTS ElevenLabs

-   **Dual Mode**: The package supports both `monologue` and `dialogue` modes. The `dialogue` mode uses the new ElevenLabs Text-to-Dialogue API, which is a significant feature.
-   **Caching**: It implements caching based on content hash to avoid unnecessary API calls, which is cost-effective.
-   **FFmpeg Integration**: It uses `ffmpeg` for audio processing (concatenation, silence generation), which is robust but adds a system dependency.

### 3.3. MD Extractor & Validator

-   **Regex-based Parsing**: The extractor uses regex for parsing specific blocks (e.g., `:::study-text`). While simple, it might be brittle if the Markdown syntax evolves.
-   **Frontmatter**: It relies on `gray-matter` for frontmatter parsing, which is standard.

### 3.4. Batch Functionality

The project includes a robust batch processing system, split into `batch-backend` and `batch-frontend`.

-   **Batch Backend**:
    -   **Architecture**: Implements a clean architecture (Domain, Application, Infrastructure, Transport layers), which is excellent for maintainability and testability.
    -   **API**: Exposes a Fastify-based REST API for job submission and status checking, plus Server-Sent Events (SSE) for real-time updates.
    -   **Database**: Uses PostgreSQL for job persistence, with a schema that mirrors the domain models.
    -   **Features**: Includes advanced features like rate limiting (Redis-backed), file sanitization, and abstract storage providers (S3, MinIO, Filesystem).
    -   **Contracts**: The `contracts` package ensures type safety between the frontend and backend, sharing DTOs and event definitions.

-   **Batch Frontend**:
    -   **Stack**: Built with React, Vite, and React Query.
    -   **Integration**: Consumes the backend API and listens to SSE for live job updates.

## 4. Adherence to Agent Guidelines

The project generally follows the guidelines outlined in `AGENTS.md` and `docs/agents-ssot.md`:

-   **SSOT**: The `docs/agents-ssot.md` file acts as the single source of truth, and the code seems to align with it.
-   **Node.js Version**: The project requires Node.js 24.10.0+, which is consistent with the documentation.
-   **Environment Variables**: It uses `dotenv` for environment variable loading and respects the `ESL_PIPELINE_` prefix for configuration.

## 5. Potential Issues and Improvements

### 5.1. Error Handling

-   **TTS Mode Errors**: The `orchestrator` has specific error handling for `ttsMode` mismatches (e.g., dialogue mode requiring voice mappings). This is good, but could be further enhanced with more specific error types.
-   **Notion Rate Limiting**: The `notion-importer` handles rate limiting with retries, but large imports might still hit limits.

### 5.2. Dependency Management

-   **FFmpeg**: The reliance on system `ffmpeg` is documented but could be a hurdle for new users. Consider adding a check or a setup script.

### 5.3. Code Consistency

-   **Type Definitions**: Some packages export types directly, while others wrap them. Consistent export patterns would be beneficial.

### 5.4. Batch Backend

-   **Complexity**: The batch backend is significantly more complex than the CLI tools. While well-architected, it introduces dependencies on Postgres and Redis, which increases the deployment burden.
-   **Security**: The extended API features (auth, sanitization) are toggleable, which is good, but requires careful configuration to ensure security in production.

### 5.5. Deep Dive Findings (Fundamental Issues)

1.  **In-Process Worker Execution**:
    -   The `batch-backend` worker executes the pipeline (`orchestrator`) within the same Node.js process.
    -   **Risk**: Any synchronous CPU-intensive operations in the pipeline (e.g., heavy parsing, synchronous file I/O) will block the Node.js event loop. This can cause the BullMQ worker to stall (miss heartbeats) and affect other concurrent jobs in the same process.
    -   **Recommendation**: Offload the pipeline execution to a child process (e.g., using `child_process.fork`) to isolate the worker loop from the heavy lifting.

2.  **Resource Contention (FFmpeg)**:
    -   The worker is configured with a concurrency of 5 (`queue-bullmq.ts`).
    -   Each job may spawn an `ffmpeg` process. This means up to 5 concurrent `ffmpeg` processes could run in a single container.
    -   **Risk**: This could easily exhaust the container's CPU or memory, leading to OOM kills or severe performance degradation.
    -   **Recommendation**: Implement resource limits or a semaphore for `ffmpeg` calls, or lower the worker concurrency based on available resources.

3.  **Event Scalability**:
    -   The system uses Redis Pub/Sub to broadcast job events to all API instances.
    -   **Risk**: As the number of jobs and API instances grows, every API instance receives every event, which is inefficient.
    -   **Recommendation**: For high scale, consider a more targeted event delivery mechanism or filtering at the subscriber level.

### 5.6. Consistency & Stability Analysis

1.  **Configuration Divergence**:
    -   **Issue**: The CLI (`orchestrator/src/pipeline.ts`) and Backend (`batch-backend/src/config/env.ts`) use different logic to resolve configuration. The CLI supports local config files (presets, voices) and complex path resolution, while the Backend relies almost exclusively on environment variables.
    -   **Risk**: A pipeline run might behave differently in the CLI vs the Backend if the environment variables don't perfectly mimic the local config file structure.
    -   **Recommendation**: Unify configuration loading. Consider making the `ConfigProvider` in the orchestrator the single source of truth for both CLI and Backend, or ensure the Backend explicitly loads the same config files as the CLI.

2.  **Error Handling Inconsistency**:
    -   **Issue**: The CLI prints errors to stderr and exits. The Backend uses a structured error handler. However, they don't share a common set of Error classes for domain failures (e.g., `FfmpegNotFoundError` is defined in `tts-elevenlabs` but not explicitly handled in the Backend's error classifier).
    -   **Risk**: The API might return generic 500 errors for known domain issues (like missing FFmpeg or Notion rate limits), making debugging difficult for API users.
    -   **Recommendation**: Create a shared `errors` package or export error types from `contracts` to ensure consistent error mapping across all interfaces.

3.  **Dependency Management**:
    -   **Status**: Dependencies are largely consistent (e.g., `@notionhq/client`, `zod`).
    -   **Observation**: `batch-backend` and `orchestrator` both depend on `@aws-sdk/client-s3`. Ensure these versions stay in sync to avoid subtle bugs.

### 5.7. Dependency Cleanup

**Completed Actions:**

1.  **Removed `dotenv`**:
    -   Removed unused import from `batch-backend`.
    -   Replaced `dotenv` with native Node.js `process.loadEnvFile()` and `node:util.parseEnv()` in `orchestrator/src/pipeline.ts`.
    -   **Benefit**: Leverages Node.js 24+ native features, reduces external dependencies, improves startup performance.

2.  **Removed `rimraf`**:
    -   Replaced all `clean` scripts with `node -e "fs.rmSync('dist', {recursive:true, force:true})"` in 8 packages.
    -   Removed `rimraf` from `devDependencies` in all affected packages.
    -   **Benefit**: Uses Node.js native `fs.rmSync()`, eliminates dev dependency from multiple packages.

3.  **Standardized Colors**:
    -   Replaced `chalk` (35 KB) with `picocolors` (3 KB) in `md-validator`.
    -   **Benefit**: Reduces bundle size, ensures visual consistency with `orchestrator` which already uses `picocolors`, and improves installation speed.

4.  **Consolidated Prompt Libraries**:
    -   **Investigation**: Analyzed both directions:
        -   ❌ `enquirer` → `prompts`: Not feasible - path picker requires `enquirer`'s advanced AutoComplete features (dynamic footers, result transformers, context-aware validation)
        -   ✅ `prompts` → `enquirer`: Feasible! All wizard prompt types supported by `enquirer`.
    -   **Action**: Replaced `prompts` with `enquirer` in `orchestrator`:
        -   Removed `prompts` and `@types/prompts` from `package.json`
        -   Refactored all 21 prompt calls in `wizard.ts`:
            -   8 Select prompts (main menu, settings, md/student/preset/mode/upload selection)
            -   7 Input prompts (custom student, dbId, dialogue language, voices, output, s3 prefix, accent)
            -   4 Toggle prompts (TTS enable, force, publicRead, dryRun)
            -   2 NumberPrompt (dialogue stability, dialogue seed)
        -   Added helper function for uniform error handling
    -   **Benefit**: Single prompt library, more powerful feature set, consistent API, reduced dependencies.

## 6. Conclusion

The `esl-pipeline` is a mature and well-engineered project. The recent addition of "Text-to-Dialogue" support in `tts-elevenlabs` and `orchestrator` is a major enhancement. The code is readable, modular, and follows best practices. The batch processing system is a robust addition that transforms the tool from a local CLI to a scalable service.

However, to achieve true stability and consistency, the project needs to address the architectural risks in the batch worker (blocking event loop) and unify the configuration and error handling strategies between the CLI and Backend.

The dependency cleanup effort has successfully modernized the project by removing `dotenv`, `rimraf`, and standardizing on `picocolors`, reducing the overall dependency footprint and leveraging native Node.js features.

## 7. Recommendations

1.  **Enhance Tests**: Ensure that the new `dialogue` mode in TTS is thoroughly tested, especially edge cases with missing voice mappings.
2.  **Documentation**: Update `README.md` and other docs to fully reflect the new `ttsMode` options and requirements.
3.  **Error Messages**: Continue to improve error messages to guide users when configuration is missing (e.g., missing voice in `voices.yml`).
4.  **Deployment Guide**: Create a specific guide for deploying the batch backend, covering Postgres/Redis setup and environment variables.
5.  **Architecture Refactor**: Prioritize moving the pipeline execution in the worker to a child process to prevent event loop blocking.
6.  **Unify Configuration**: Refactor `batch-backend` to use the `orchestrator`'s config resolution logic where possible, or strictly define the mapping between env vars and config files.
7.  **Shared Error Handling**: specific domain errors should be mapped to HTTP status codes in the backend to provide better feedback.

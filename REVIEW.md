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

## 5. Outstanding Issues and Implementation Plan

### 5.1. FFmpeg Dependency Management

**Current State**: FFmpeg detection and error handling is already well-implemented in `packages/tts-elevenlabs/src/ffmpeg.ts`.

**Features**:
- Automatic detection with fallback search (explicit path → cache → system PATH)
- Clear,helpful error messages with platform-specific installation instructions
- Support for `FFMPEG_PATH` environment variable
- Comprehensive error handling with `FfmpegNotFoundError`

**No action required** - the existing implementation provides excellent user experience with detailed guidance when FFmpeg is missing.

### 5.2. Resource Contention (FFmpeg Concurrency) - **IMPLEMENTED**

**Problem**: The batch-backend worker processes up to 5 jobs concurrently (configurable), with each potentially spawning FFmpeg processes. Without limits, this could exhaust CPU/memory.

**Solution Implemented**: Redis-based distributed semaphore to limit concurrent FFmpeg operations across all worker processes (now fully wired and tested).

**Components**:
1. **FFmpeg Semaphore** (`packages/batch-backend/src/infrastructure/ffmpeg-semaphore.ts`):
   - **TTL-based locks** (fixes P1): each lock uses `SET ... EX` with periodic cleanup to recover from crashed workers.
   - **BLPOP blocking** (fixes P2): blocking queue wait restores FIFO fairness and removes busy-spin.
   - **Test safety fixes**: mocks now target correct module specifiers and provide default Redis responses to avoid runaway loops and OOMs during tests.
   - Instance registry, optional periodic cleanup (on in prod, off in tests), and `getStats()` monitoring.

2. **Configuration** (`packages/batch-backend/src/config/env.ts`):
   - `WORKER_CONCURRENCY` (default: 5): Number of jobs processed simultaneously
   - `MAX_CONCURRENT_FFMPEG` (default: 3): Maximum concurrent FFmpeg operations
   - Validation ensures `MAX_CONCURRENT_FFMPEG ≤ WORKER_CONCURRENCY`

3. **Integration** (`packages/batch-backend/src/infrastructure/pipeline-worker-entry.ts`):
   - Semaphore acquired before TTS operations
   - Released in `finally` block to ensure cleanup
   - Logging for acquire/release events

**Critical Bugs Fixed**:
- **[P1] Crashed worker leak**: Implemented TTL-based locks with automatic expiry (5min) + periodic cleanup
- **[P2] Busy-spin wait loop**: Replaced polling with Redis `BLPOP` (30s timeout) for efficient blocking

**Test Status**:
- ✅ Build successful
- ✅ Batch-backend tests now pass without OOM after fixing semaphore test mocks (Redis/logger specifiers and default stub returns)

**Remaining Work**:
- [ ] (optional) High-load validation of new semaphore under multi-worker contention
- [ ] Conduct high-load testing to validate limits and tune defaults
- [ ] Document configuration in batch-backend README

### 5.3. Event Scalability Optimization

**Problem**: The system uses Redis Pub/Sub to broadcast job events to all API instances. As jobs and API instances scale, every instance receives every event, creating inefficiency.

**Action Items**:
1. Implement event filtering at the subscriber level (subscribe only to relevant job IDs)
2. Add metrics to monitor event delivery efficiency
3. Document scaling considerations for production deployments
4. Consider targeted event delivery for high-scale scenarios

### 5.4. Batch Backend Deployment Complexity

**Issue**: The batch backend requires Postgres and Redis, increasing deployment complexity compared to the CLI.

**Action Items**:
1. Create comprehensive deployment guide covering Postgres/Redis setup
2. Document all required environment variables
3. Provide example Docker Compose configuration for local testing
4. Add production deployment best practices (HA, backups, monitoring)

## 6. Conclusion

The `esl-pipeline` is a mature and well-engineered project with significant recent improvements:

**Completed Enhancements**:
- ✅ Standardized error handling across all packages using shared error classes
- ✅ Unified configuration resolution between CLI and batch backend
- ✅ Modernized dependencies (removed `dotenv`, `rimraf`; standardized on `picocolors` and `enquirer`)
- ✅ Fixed architectural issues (worker event loop blocking via child process isolation)
- ✅ Improved type consistency and exports across packages

**Remaining Focus Areas**:
The project needs attention in four areas to achieve production-ready status:
1. **FFmpeg dependency management**: Add detection and helpful error messages
2. **Resource contention**: Implement semaphore for concurrent FFmpeg operations
3. **Event scalability**: Optimize Redis Pub/Sub for high-scale scenarios
4. **Deployment documentation**: Comprehensive guides for batch backend setup

## 7. Next Steps

Based on section 5 analysis, implement the following in priority order:

1. **FFmpeg Detection** (High Priority):
   - Add startup check in orchestrator
   - Provide installation instructions in error messages
   - Update setup documentation

2. **Resource Management** (High Priority):
   - Implement FFmpeg operation semaphore in batch-backend
   - Add `MAX_CONCURRENT_FFMPEG` environment variable
   - Test under high-load scenarios

3. **Event Optimization** (Medium Priority):
   - Implement subscriber-level event filtering
   - Add event delivery metrics
   - Document scaling best practices

4. **Documentation** (Medium Priority):
   - Create batch backend deployment guide
   - Add Docker Compose example configuration
   - Document production deployment considerations

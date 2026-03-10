## Wave 1 Implementation Plan (Step-by-Step, Single PR, Commit-by-Item)

### Summary
Implement Wave 1 in a new branch with one commit per backlog item, then open one combined Wave 1 PR.  
Per your decisions, proceed now with unblocked items (`LR-007`, `LR-008`, `LR-009`) and block `LR-006`/`LR-010` until dependency evidence is provided in PR comments.

### Implementation Sequence
1. Branching and PR shape
   - Create `codex/legacy-retirement-wave1` from `main`.
   - Use one commit per item (local review checkpoints), then one consolidated Wave 1 PR with `release:patch`.

2. `LR-007` (unblocked): retire job-event legacy broadcast channel
   - Change Redis job-event bridge to publish only targeted channels.
   - Preserve all-jobs listener behavior by using pattern subscription (`batch_job_events:*`) instead of broadcast channel.
   - Update bridge tests to assert:
     - no publish to `batch_job_events` base channel,
     - targeted and pattern listener delivery still works,
     - no duplicate fanout with mixed subscriptions.
   - Update docs references for event-channel behavior.
   - Review ping: after this commit.

3. `LR-008` (unblocked): retire legacy settings provider normalization path
   - Add migration to sanitize `user_settings.tts_provider` legacy values (`openai`/`azure` -> `elevenlabs`) and tighten check constraint to canonical providers.
   - Update canonical schema to match migration end state.
   - Simplify normalization logic to handle only canonical/unknown fallback path (no explicit legacy branch).
   - Update/adjust repository tests for new normalization/constraint behavior.
   - Review ping: after this commit.

4. `LR-009` (unblocked): remove auth env-fallback constructor behavior
   - Make auth-service creation require explicit config input.
   - Wire auth-service from loaded server config in HTTP runtime (no direct env fallback constructor path).
   - Update auth call sites (middleware + auth routes) to use injected/config-derived auth-service instance.
   - Update auth-service tests to remove no-config constructor expectations and validate explicit config usage.
   - Review ping: after this commit.

### Blocked Items and Unblocking Evidence
1. `LR-006` remains blocked until prod-like evidence is attached in PR comments:
   - Run and paste outputs for the two reconciliation queries already documented in `docs/plans/postgres-hardening-offline-migration/offline-data-migration-runbook.md`:
     - `null_but_derivable` count
     - `denorm_drift_rows` count
   - Required unblock condition: both counts are `0`.

2. `LR-010` remains blocked until storage migration evidence is attached in PR comments:
   - Paste SQL/log evidence showing filesystem migration completion for uploaded-file metadata (at minimum: no remaining filesystem-backed rows in active environment).
   - Required unblock condition: migration completion confirmed by captured output, then retire `migrateFileToS3`.

### Test Plan
1. Per-item required tests
   - `LR-007`: `pnpm --filter @esl-pipeline/batch-backend test -- infrastructure.job-event-redis-bridge.test.ts`
   - `LR-008`: `pnpm --filter @esl-pipeline/batch-backend test -- domain.settings-repository.test.ts`
   - `LR-009`: `pnpm --filter @esl-pipeline/batch-backend test -- infrastructure.auth-service.test.ts`
2. Integration/type safety gates after each item commit
   - `pnpm --filter @esl-pipeline/batch-backend typecheck`
   - Targeted integration tests for touched transport/auth paths.
3. Pre-PR and pre-merge gates
   - `pnpm check:fast`
   - `pnpm docs:check` (for doc/SSOT updates)
   - Ensure PR has exactly one label: `release:patch`.

### Assumptions and Defaults
1. Single Wave 1 PR, with one commit per item and review ping after each commit.
2. `LR-006` and `LR-010` are hard-blocked until evidence is provided (no code changes for those items before unblock).
3. No public API contract changes are expected for unblocked Wave 1 items; all are internal/runtime hardening.
4. Inventory statuses are updated as work progresses (`in_progress`/`done` for unblocked items, `blocked` for gated items).

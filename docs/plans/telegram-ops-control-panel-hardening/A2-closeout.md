# A-Track Completion Plan: `A2` Closeout + `A` Durability

## Summary

1. Finish all remaining `A2` hardening items first, with CI-verifiable acceptance gates.
2. Immediately follow with `A` durability work currently marked `V2/Defer`, but keep it additive and backward-compatible.
3. Keep roadmap sequencing intact: no `B1` feature expansion until `A` reliability, observability, and operability are demonstrably stable.

## Implementation Changes

### Phase 1: `A2` Closeout (blocking before broader rollout)

1. Add missing backend transport integration coverage for `/ops/*`.
   - Create a dedicated HTTP integration suite for `/ops/status`, `POST /ops/actions`, and `GET /ops/actions/:operationId`.
   - Validate route registration gating (`BATCH_BACKEND_ENABLE_OPS_CONTROL` off => routes unavailable).
   - Validate shared-secret enforcement behavior (`x-ops-bot-secret` missing/wrong/right).
   - Validate payload validation (`action` enum, optional `label` constraints), success codes (`200/202`), and not-found semantics (`404`).
   - Validate failure-path mapping (`validation_failed`, `internal_error`) stays stable.

2. Add deterministic compose smoke workflow for Telegram command loop.
   - Introduce `TELEGRAM_OPS_BOT_API_BASE_URL` (default `https://api.telegram.org`) so smoke runs can target a local fake Telegram API.
   - Add a lightweight fake Telegram API service for compose smoke that supports `getMe`, `getUpdates`, `sendMessage`, `getChat`, `createForumTopic`.
   - Add a smoke script that boots compose services, injects deterministic updates (`/status`, `/op`, `/share`), and asserts outbound message payloads and thread routing behavior.
   - Run this smoke workflow in CI as part of integration verification (initially allowed to be quarantined for short stabilization period, then promoted to blocking).

3. Add deterministic `/share` hardening checks end-to-end at bot command-loop level.
   - Add runner-level smoke tests for three deterministic scenarios: markdown-first extraction, html fallback extraction, and missing-audio graceful degradation.
   - Assert exact message ordering and preview behavior: assignment message with preview disabled, audio messages with preview enabled.
   - Assert extraction precedence stays stable: markdown labeled links > markdown path hints > html path hints.

4. Improve topic cache healing for stale/deleted forum topics.
   - Add runtime healing when send fails with stale thread semantics (`message thread not found`-class errors).
   - Healing algorithm: invalidate stale mapping, persist updated state, attempt topic re-create once when forum+auto-create are enabled, retry send once, then fallback to default/root thread.
   - Add audit events for each step (`topic_stale_detected`, `topic_recreated`, `topic_heal_fallback`) to make healing observable.
   - Add unit tests for stale-topic recovery, recreate failure fallback, and no-infinite-retry guarantees.

5. Add bot-side operational telemetry for A-track reliability.
   - Add structured events/counters for command outcome, share extraction source, missing-audio rate, and fallback-source rate.
   - Keep telemetry additive and log-based first; no contract change required for this step.
   - Update ops runbook with troubleshooting flows for startup replay protection, topic healing, and share-fallback diagnostics.

### Phase 2: `A` Durability and Scale (formerly deferred, now planned)

1. Persist ops action history to Postgres while keeping API shape unchanged.
   - Add migration for `ops_actions` table with operation lifecycle fields and indexed lookup by `operation_id`.
   - Implement repository-backed writes on queue/start/finish transitions and reads for status lookup.
   - Keep in-memory cache as read-through/write-through optimization, not source of truth.
   - Add retention pruning policy (`BATCH_BACKEND_OPS_CONTROL_ACTION_RETENTION_DAYS`) and bounded query windows.

2. Add single-active-instance coordination for bot polling and action execution.
   - Add DB advisory-lock leader election for long-polling so only one bot instance consumes Telegram updates.
   - Add per-operation idempotency/ownership guard in backend action execution path to prevent duplicate execution under restarts/failover.
   - Keep default deployment model simple (single instance), but make multi-instance safe when enabled.

3. Add webhook-mode foundation and advanced controls as optional, gated capability.
   - Add optional webhook transport mode behind explicit env flag; keep long-polling as default.
   - Add approval-gated command framework for high-risk controls (restart/maintenance class) with explicit actor/audit trail.
   - Keep these commands disabled by default and out of baseline operator flow until post-hardening validation.

## Public Interfaces and Contract Changes

1. Additive env vars only (no breaking changes):
   - `TELEGRAM_OPS_BOT_API_BASE_URL` for deterministic smoke/testing.
   - `BATCH_BACKEND_OPS_CONTROL_ACTION_RETENTION_DAYS` for persisted-history pruning.
   - `TELEGRAM_OPS_BOT_LEADER_ELECTION_ENABLED` for multi-instance polling safety.
   - `TELEGRAM_OPS_BOT_MODE` (`polling` default, `webhook` optional) for transport selection.

2. API contract stance:
   - Keep existing `/ops/*` request/response contracts unchanged.
   - Keep existing Telegram command syntax unchanged.
   - Any future share-metadata DTO additions must be additive optional fields only.

## Test Plan and Acceptance Gates

1. Required automated coverage additions:
   - New backend HTTP integration suite for `/ops/*`.
   - New bot runner smoke tests for `/share` deterministic behavior and topic-heal recovery.
   - Compose smoke script + CI execution path for Telegram loop safety.

2. Required command-level safety checks:
   - `TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP=true` prevents stale replay.
   - `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false` blocks `/backup` and `/drill`.
   - `/op <operationId>` returns queued/running/succeeded/failed lifecycle states consistently.

3. CI/lane expectations:
   - Unit lane remains green for bot/backend packages.
   - Integration lane includes new `/ops/*` transport coverage.
   - Compose smoke is green and deterministic before declaring `A2` complete.

4. Operational sign-off before closing `A`:
   - No unhealed stale-topic incidents during manual soak window.
   - No ambiguous `/share` output regressions across smoke fixtures.
   - Persisted action history survives backend restart and remains queryable by `operationId`.

## Assumptions and Defaults

1. `A` completion means both `A2` hardening closure and practical durability readiness, not just feature completeness.
2. Long-polling remains default transport until webhook mode is explicitly enabled.
3. Action commands remain disabled-by-default in production unless explicitly enabled.
4. `B1` work starts only after the above acceptance gates are satisfied and stable for at least one short soak period.

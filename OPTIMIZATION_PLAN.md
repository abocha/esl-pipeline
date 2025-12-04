# Optimization Plan (Contract-Safe)

Author: Codex agent
Scope: Execute optimizations without breaking SSOT contracts. Any contract change (e.g., new observability event) must update docs/tests in the same change.

## 1) Stage Timings (possible contract change)
- Audit observability events; if start is missing, adding it is a contract change requiring docs/tests + SSOT/README updates.
- Instrument `newAssignment` and `rerunAssignment` with start/success/fail at existing stage boundaries; avoid duplicate logs on retries and preserve error propagation.
- Tests: ordering, one event per stage, rerun parity.

## 2) Opt-in Config/Env Memoization
- Knob for CLI (env flag) and programmatic (`createPipeline` option); default off.
- Cache key: cwd, configDir/presetsPath/voicesPath/studentsDir/wizardDefaultsPath, env file paths + mtimes + sizes (all loaded, in order), wizard defaults, and any programmatic env overrides. No cross-pipeline leakage.
- Tests: load order preserved, mid-process `.env` change invalidates cache, differing cwd/args/env overrides get distinct caches.

## 3) Internal Parsed-MD Cache (Per Run)
- Per-run cache keyed by md path + mtime + size; bypass if `fs.stat` fails (non-local/guard).
- Keep normalized text identical; no public API change.
- Tests: line/column stability, duplicate processing in one run, cache bypass on file change.

## 4) Notion Importer/Colorizer Concurrency + Cache
- Measure current batching/concurrency; default limiter must equal current behavior (tests enforce).
- Per-run schema cache keyed by (dbId, token-hash); no cross-run sharing.
- Colorizer fast path only when presets undefined/empty; preserve order and avoid mutation unless already guaranteed.
- Tests: ordering/immutability, default concurrency, cache scoping.

## 5) TTS/Uploader
- Audit existing clients/agents; add keep-alive only if absent (avoid double pooling).
- Concurrency flags/envs documented with exact names/defaults; honored in CLI + programmatic flows. Defaults = current behavior.
- Preserve temp+rename atomicity and existing retry/backoff/content-length logic.
- Tests: concurrency config honored, atomic writes intact.

## 6) Manifest Cache (Opt-in, Default Off)
- Per-process cache with bust-on-write and optional TTL. Remote adapters (S3) require strong freshness: use etag if present; if only last-modified exists, accept; if neither/weak, disable cache. Default disabled for remote.
- Tests: cache disabled for weak freshness, bust on write, local vs remote behavior.

## 7) CLI Lazy-Load Audit
- Inventory heavy deps (Notion SDK, AWS SDK, ElevenLabs, ffmpeg bindings); verify no required env validation/side effects are deferred.
- Defer only stage-specific heavy deps post-audit; keep dist usage.
- Tests: unit test for eager env validation; smoke `--version`, `status`, `rerun`, full pipeline.

## 8) CI/Runtime
- Decide/document `deps:check` placement to avoid slowing fast lint; keep defaults unless touched-package detection is concrete (git diff + pnpm filter).
- Document any new flags/envs in `docs/agents-ssot.md` (SSOT) + README (+ `docs/groundwork-for-backend.md` if backend-facing) in the same change.

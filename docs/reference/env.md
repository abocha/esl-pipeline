# Environment Configuration Guide

## Meta

- Audience: maintainers and implementing agents.
- Read Time: 5 minutes.
- Authority Level: environment contract reference.
- Last Verified Against: 2026-10-10 ESL-41 provider migration.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after environment contract changes.
- Status: `reference`.

## Purpose

- Define the canonical env surfaces for the repo.
- Keep policy and defaults here while pushing exhaustive key lookup to the generated env index.

## Canonical Files

- `.env`: local development and development Compose configuration.
- `/etc/esl-pipeline/production.env`: canonical production application configuration, root:root
  `0600`, under root-owned protected ancestors; also used by privileged host tools.
- `.secrets/`: runtime credential files only, mounted read-only; never operator env backups.
  Production keeps the existing Google credential path with directory root:1000 `0750` and file
  root:1000 `0640`, under the protected checkout.
- `/var/lib/esl-pipeline/deploy/*.env`: generated image state, except explicitly retained restricted
  operator migration snapshots; image state is never a substitute for application configuration.
- [Generated key lookup](../generated/env-surface-index.md).

Direct development CLI entrypoints retain their existing `.env.batch-backend` fallback when `.env`
is absent. Production Compose and privileged host wrappers use the protected canonical path.
`ESL_PRODUCTION_ENV_FILE` selects the Compose input for isolated local configuration fixtures;
production host guards require the canonical path. It is not a production path override.

## Validation and Migration

Local development uses `pnpm env:validate -- --profile=development`. Production values are validated
through the published backend image by the existing deployment preflight, using the same Compose
environment as runtime. Do not run a production validator against a stale checkout-local `.env` or
print rendered Compose configuration containing real secrets.

For existing hosts, use the [ESL-53 operator migration](../operations/production-config-reconciliation.md).
Prepare and review repository changes first; live migration and deployment require maintainer
involvement. Preserve credentials, signing identity, backups and image rollback metadata.

## Bootstrap Policy

- New direct executable entrypoints should load env through shared `loadApplicationEnv()` from
  `@esl-pipeline/shared-infrastructure`.
- Do not add ad-hoc dotenv parsing in package entrypoints.
- Host-invoked tools and container runtime are different contexts:
  - Compose-safe defaults like `PG_HOST=postgres` remain canonical for containers.
  - Host tools should adapt internally when they need `127.0.0.1`.

## Runtime Groups

### Shared runtime and orchestrator

Primary groups:

- HTML publishing / manifests:
  - `AWS_*`, `S3_*`, `STORAGE_*`, `ESL_PIPELINE_MANIFEST_*`
- Speech runtime:
  - `ESL_TTS_*`, `ESL_STT_*`, `VOICE_ALIGNMENT_V2_*`
  - `ESL_TTS_DEFAULT_PROVIDER` selects the provider for fresh study-text generation; when unset,
    it defaults to `gemini`. The authoring UI uses this backend default without adding selectors.
    Explicit selections and saved job/session choices take precedence. New user settings inherit
    the configured default; existing user settings are not rewritten.
  - `gemini` TTS uses Google Cloud ADC plus explicit
    `ESL_TTS_PROVIDER_GEMINI_PROJECT_ID`. `ESL_TTS_PROVIDER_GEMINI_MODEL` defaults to
    `gemini-3.8-flash-lite-tts`; `gemini-3.8-flash-tts` is selectable.
    `ESL_TTS_PROVIDER_GEMINI_TIMEOUT_MS` defaults to 180000 (1000–300000). This lane uses the
    fixed global Cloud endpoint, deterministic prebuilt voices and identity speech planning, with
    no external planner/ranker calls or AI Studio key. The full pronunciation sentence follows the
    study-text provider/model; short pronunciation item clips default to Google `chirp3_hd`.
    Technical reruns can override each family independently.
    Configure ADC for the selected Cloud project before selecting it; `gcloud auth login` alone
    is separate from Application Default Credentials. See the
    [Gemini adapter](../../packages/tts-provider-gemini/README.md) for limits and cache behavior.
  - Inworld TTS uses `INWORLD_API_KEY` or `ESL_TTS_PROVIDER_INWORLD_API_KEY`, plus optional `ESL_TTS_PROVIDER_INWORLD_*` model/voice/runtime overrides.
  - `ESL_TTS_PROVIDER_INWORLD_TIMEOUT_MS` bounds each in-flight SDK request. The SDK client is lazy
    and reusable, and its internal `maxRetries` is always `0`.
  - `ESL_TTS_PROVIDER_INWORLD_RETRY_MAX` defaults to `3` and is clamped to `0`-`3`. The application
    owns the initial attempt plus up to three retries with 1/2/4-second bases and uniform plus or
    minus 20 percent jitter. Only HTTP 408/429/5xx and typed transient network, reset, disconnect,
    or timeout failures retry; caller cancellation, expired deadlines, auth/permission, invalid
    requests/voices, and other deterministic 4xx failures do not.
  - Caller cancellation and deadlines are observed between SDK calls. The installed SDK cannot
    cancel `generate()` after it starts, so the configured SDK timeout remains the in-flight bound.
    Routine diagnostics use hashes, counts, normalized categories, latency, cache totals, and output
    bytes without learner text or raw provider bodies.
  - Expressive study-text planning uses opt-in `ESL_TTS_SPEECH_PLANNER_ENABLED`, explicit
    `ESL_TTS_SPEECH_PLANNER_PROVIDER`, optional model/output-token controls, and separate
    `ESL_TTS_SPEECH_PLANNER_*_BUDGET` limits. The planner remains disabled until explicitly enabled,
    with `openai` plus exact `gpt-5.6-luna` selected by default. Google AI Studio and OpenRouter LLM overrides are retired.
  - Speech planning uses `OPENAI_API_KEY` and
    sends `store: false`. Credentials, allowlists, RPM/daily request limits, token budgets, and
    spend accounting remain provider/model keyed. Typed timeout retries stay within one provider
    and reserve every physical request attempt.
  - The historical Gemini speech-planner evaluation matrix is offline-only; `--live` fails before provider construction.
  - Inworld voice planning uses `ESL_TTS_VOICE_RANKER_ENABLED`, optional `ESL_TTS_VOICE_RANKER_MODEL`, optional `ESL_TTS_VOICE_RANKER_MAX_OUTPUT_TOKENS`, and separate `ESL_TTS_VOICE_RANKER_*_BUDGET` limits. The default semantic ranker uses OpenAI Responses `gpt-5.6-luna`, low reasoning/verbosity, strict JSON, `store: false`, and OpenAI token budgets.
  - Local planner inspection can opt into full validated or rejected plan logs with `ESL_TTS_SPEECH_PLANNER_DEBUG_LOG_PLAN=true`. Voice-ranker inspection can opt into shortlist and failure details with `ESL_TTS_VOICE_RANKER_DEBUG_LOG_PLAN=true`. Leave these disabled outside short-lived debugging because logs may include learner text.
  - Pronunciation primary/item synthesis never uses the speech planner. Dialogue and monologue
    study-text synthesis do; `auto` resolves dialogue only for two or more distinct authored
    speakers.
  - After changing planner env values in a Compose deployment, recreate `batch-backend` and `batch-worker`.
- Remote config:
  - `ESL_PIPELINE_CONFIG_*`
- Optional logging/debug:
  - `LOG_LEVEL`

Read next:

- [`packages/orchestrator/README.md`](../../packages/orchestrator/README.md)
- [`docs/reference/GENERATION_PROVIDER_POLICY.md`](GENERATION_PROVIDER_POLICY.md)
- [`docs/PIPELINE_INTEGRATION_VISION.md`](../PIPELINE_INTEGRATION_VISION.md)

### Batch backend service

Primary groups:

- API/runtime:
  - `NODE_ENV`, `BATCH_BACKEND_HTTP_PORT`, `BATCH_BACKEND_ENABLE_EXTENDED_API`
- Infra:
  - `PG_*`, `REDIS_*`, `BATCH_JOBS_QUEUE_NAME`, `TRANSCRIBE_QUEUE_NAME`
- Worker/runtime:
  - `WORKER_CONCURRENCY`, `MAX_CONCURRENT_FFMPEG`, `FILESYSTEM_UPLOAD_DIR`, `PIPELINE_CWD`
- Recording ingest:
  - `RECORDINGS_MAX_FILE_SIZE` defaults to `2147483648` bytes (2 GiB). The browser applies the
    shared default before starting a request; a smaller backend override remains authoritative.
  - `RECORDINGS_DISK_RESERVE_BYTES` defaults to `10737418240` bytes (10 GiB). Admission requires
    the temp filesystem to retain this reserve after one configured maximum-size upload; it is a
    point-in-time check, not a cross-request disk reservation.
  - Probed recording duration is capped at `6000` seconds (100 minutes). FFmpeg and ffprobe
    must be present in the API/worker runtime, the temp directory must be writable, and
    `MAX_CONCURRENT_FFMPEG` must fit host CPU and temp capacity.
  - S3 recording submission requires configured Get/Put/Delete access plus presigned-URL reachability
    from ElevenLabs. Filesystem submission requires the retained local file to remain readable by the
    transcribe worker.
- Recording audio retention:
  - `RECORDING_AUDIO_CLEANUP_ENABLED` defaults to `false`; the transcribe worker does not claim or
    physically delete recording-owned audio until an operator enables it after rehearsal.
  - `RECORDING_AUDIO_RECOVERY_TTL_DAYS` defaults to `7` and must be an integer from 1 through 3650.
  - Use the [recording-audio cleanup runbook](../operations/recording-audio-cleanup.md) before
    enabling cleanup.
  - Use the [ordinary recording ingest rollout runbook](../operations/ordinary-recording-ingest-rollout.md)
    for migrations 0049-0053, run/reservation inspection, media-runtime verification, and rollback.
- Auth/security/uploads:
  - `JWT_*`, `REFRESH_*`, `ENABLE_*`, `CORS_*`, upload limits
  - `MCP_OAUTH_ENABLED` defaults to `false`. When set to `true`, the extended authentication API
    must be enabled and `MCP_OAUTH_ISSUER`, `MCP_OAUTH_RESOURCE`, `MCP_OAUTH_COOKIE_KEYS`, and
    `MCP_OAUTH_JWKS` are required. The issuer and resource must share an HTTPS origin and have
    exact paths `/api/oauth` and `/api/mcp`. Cookie keys are a JSON array of random secrets of
    at least 32 characters each. JWKS is a private signing JWK Set in JSON; keep it and the cookie
    keys secret, separate from the REST JWT secret. Retain keys across restarts; rotate with overlap.
    The `/api/mcp` URL is both the OAuth audience and the stateless Streamable HTTP resource.
    This setting remains false by default; production activation is a separate step.
  - Caddy production keeps `REFRESH_COOKIE_DOMAIN` absent, `REFRESH_COOKIE_SECURE=true`,
    `REFRESH_COOKIE_PATH=/`, and `ENABLE_CORS=false`. Cookies and browser storage are host-specific;
    a canonical-host change requires browser login and MCP reconnection.
  - `CADDY_PUBLIC_HOSTNAME` is the single canonical public hostname; when MCP OAuth is enabled,
    its issuer/resource must be exactly `https://<CADDY_PUBLIC_HOSTNAME>/api/oauth` and `/api/mcp`.
    Production environment validation checks alignment, OAuth key configuration and the enabled
    extended API before deployment can recreate services.
    `validate-env --runtime --profile production` checks the effective container environment;
    the default file mode continues to check `.env` syntax and duplicate keys locally.
  - `CADDY_TRANSITION_MODE` defaults to `disabled` with `CADDY_TRANSITION_HOSTNAME` absent.
    `serve` temporarily exposes the same application/API on one distinct hostname while rejecting
    its OAuth/MCP/discovery routes with 410. `redirect` permits only query-free GET/HEAD browser
    paths to move to the canonical HTTPS origin with uncached 302 responses; APIs, writes and
    query-bearing requests return 410. This is an edge transition, not a second OAuth issuer.
    See [canonical domain migration](../operations/canonical-domain-migration.md).

Read next:

- [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)
- [`docs/generated/backend-route-index.md`](../generated/backend-route-index.md)

### Direct generation policy

Primary groups:

- Provider credentials:
  - `OPENAI_API_KEY`
- Explicit workload targets:
  - `GEN_ASSIGNMENT_PROVIDER/MODEL`, `GEN_LESSON_MEMORY_PROVIDER/MODEL`,
    `GEN_HOMEWORK_MEMORY_PROVIDER/MODEL`, `GEN_STUDENT_MEMORY_SNAPSHOT_PROVIDER/MODEL`,
    `GEN_PROFILE_DRAFT_PROVIDER/MODEL` (each slash names two env variables)
  - only OpenAI is admitted; assignment defaults to Sol 6.1, memory/profile to Luna 5.6
  - bounded workload model default: `GEN_OPENAI_MODEL`
  - `GEN_ALLOWED_MODELS_OPENAI` is an explicit selection roster and Batch/planner guard, never fallback
- Output protection and budgets:
  - `GEN_MAX_OUTPUT_TOKENS_HARD`, `GEN_SAFETY_MODE`, `GEN_*_BUDGET`
- Disabled Batch replay:
  - `STUDENT_MEMORY_OPENAI_BATCH_ENABLED` defaults to `false` and gates every remote Batch action
- Timeouts/retries:
  - `GEN_OPENAI_REQUEST_TIMEOUT_MS`; speech planning alone uses `GEN_OPENAI_RETRY_*`
  - assignment/profile provider failure is explicit; memory workers retain durable queue retries
- Removed fallback and paid-spend variables are ignored. Use the linked target-policy rollout
  procedure to translate existing env settings before deployment.

Read next:

- [`docs/reference/GENERATION_PROVIDER_POLICY.md`](GENERATION_PROVIDER_POLICY.md)
- [ESL-41 combined rollout/rollback](../operations/openai-llm-migration.md)

### Postgres ops and backups

Primary groups:

- Backup/archive:
  - `PG_BACKUP_S3_*`, `PG_BACKUP_HOST_STATE_DIR`, `PG_BACKUP_LOCAL_RETENTION_DAYS`,
    `PG_BACKUP_REMOTE_RESTORE_RETENTION_DAYS`
- Ops health / alerting:
  - `PG_BACKUP_HEALTH_*`, `PG_BACKUP_RESTORE_DRILL_*`, `PG_BACKUP_ALERT_*`
- Container targeting:
  - `PG_COMPOSE_PROJECT`, `PG_COMPOSE_FILE`, `PG_CONTAINER_NAME`

Use the `pnpm docker:prod:db:*` wrappers for the production Compose stack; they set the production
Compose project/file/container, host-state, and default `prod` namespace before delegating to the
shared backup scripts. Host operation paths are never container `/app/...` paths.

Read next:

- [`docs/operations/postgres-backup-restore.md`](../operations/postgres-backup-restore.md)
- [`docs/operations/postgres-backup-s3.md`](../operations/postgres-backup-s3.md)
- [`docs/operations/postgres-ops-health.md`](../operations/postgres-ops-health.md)

### Telegram ops bot

Primary groups:

- Enablement/runtime:
  - `TELEGRAM_OPS_BOT_ENABLED`, `TELEGRAM_OPS_BOT_MODE`, `TELEGRAM_OPS_BOT_API_BASE_URL`
- Safety and routing:
  - `TELEGRAM_OPS_BOT_ALLOWED_USER_IDS`, `TELEGRAM_OPS_BOT_CHAT_ID`, `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS`, `TELEGRAM_OPS_BOT_TOPIC_*`
- Webhook/polling:
  - `TELEGRAM_OPS_BOT_WEBHOOK_*`, `TELEGRAM_OPS_BOT_LEADER_ELECTION_ENABLED`, `TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP`
- Backend bridge:
  - `TELEGRAM_OPS_BOT_BACKEND_*`, `TELEGRAM_OPS_BOT_APPROVAL_REPLAY_*`

Read next:

- [`packages/telegram-ops-bot/README.md`](../../packages/telegram-ops-bot/README.md)
- [`docs/operations/telegram-ops-control-panel.md`](../operations/telegram-ops-control-panel.md)

## Default and Safety Notes

- Prefer namespaced canonical variables over legacy aliases when both exist.
- Pronunciation synthesis uses the configured provider stack; container images do not provision a
  separate pronunciation helper runtime.
- Budget values of `0` are intentional hard stops, not “unset”.
- Generation battle-testing defaults should stay fail-safe:
  - `GEN_SAFETY_MODE=hard_stop`
  - `GEN_MAX_OUTPUT_TOKENS_HARD=12000`
- Direct generation provider requests default to 240000 ms unless overridden per provider.
- `GEN_OPENAI_EFFICIENT_DAILY_TOKEN_BUDGET=2250000` and
  `GEN_OPENAI_LARGER_DAILY_TOKEN_BUDGET=225000` cap shared model-group reservations per UTC day.
  Nonnegative safe integers are required; zero is an intentional stop. Unknown model groups fail closed.
  The obsolete `GEN_OPENAI_DAILY_TOKEN_BUDGET` is ignored; remove it at authorized cutover.
  `GEN_OPENAI_DAILY_REQUEST_BUDGET` has no default; an explicit nonnegative ceiling remains supported.
  See [group policy and cutover](GENERATION_PROVIDER_POLICY.md#openai-model-group-daily-budgets-esl-45).
- `GEN_OPENAI_TPM_BUDGET` defaults to `160000`; it is an operator capacity setting, not a billing or
  plan-tier setting.
- The opt-in live generation evaluation entrypoint loads `.env` before it checks
  `GENERATION_LIVE_EVAL_ENABLED=true` and `OPENAI_API_KEY`; both are required before it
  will call OpenAI.
- `STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false` is a separate remote-operation gate. `dry-run`
  planning is local only; Batch upload, status, polling, reconciliation, retry, and cancellation
  must remain disabled until an operator explicitly enables this flag.
- Telegram mutating ops stay disabled unless `TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=true`.
- Backend ops control is additive and should remain off unless explicitly enabled with
  `BATCH_BACKEND_ENABLE_OPS_CONTROL=true`; command execution also requires explicit
  `BATCH_BACKEND_OPS_CONTROL_*_COMMAND` values and must not depend on Docker/AWS tooling inside the
  long-running backend container.

## Exhaustive Lookup

### Google Calendar scheduling

`GOOGLE_CALENDAR_ENABLED` defaults off. Calendar uses `GOOGLE_CALENDAR_CLIENT_ID`,
`GOOGLE_CALENDAR_CLIENT_SECRET`, the exact `GOOGLE_CALENDAR_REDIRECT_URI`,
`INTEGRATION_CREDENTIAL_ACTIVE_KEY_ID` and the versioned `INTEGRATION_CREDENTIAL_KEYS` JSON keyring.
Configure API and batch-worker consistently. These credentials confer Calendar access, never ESL
login/signup. Invalid partial configuration makes Calendar unavailable; unrelated teaching workflows
remain available. Never reuse JWT/settings encryption keys or log the keyring.

See the [Calendar cutover runbook](../operations/google-calendar-cutover.md) for callback-cookie,
scope/offline, ingress logging, rotation and separately authorized provider/operator evidence.

For full key-by-key lookup, ownership, and next-hop docs, use:

- [`docs/generated/env-surface-index.md`](../generated/env-surface-index.md)

## Related

- [`packages/orchestrator/README.md`](../../packages/orchestrator/README.md)
- [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)
- [`packages/telegram-ops-bot/README.md`](../../packages/telegram-ops-bot/README.md)
- [`docs/reference/GENERATION_PROVIDER_POLICY.md`](GENERATION_PROVIDER_POLICY.md)

## Student-owned profile cutover

API contract 6 and DB contract 1 retire `PROMPT_PROFILE_PATH`. Prompt bootstrap imports templates
only; student onboarding and Learning own profile revisions. `PG_ENABLE_LEGACY_SCHEMA_PATCHES`
cannot enable runtime DDL. Remove both obsolete settings when reconciling environment files.

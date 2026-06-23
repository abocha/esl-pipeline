# Voice Alignment V2 Runbook

## Meta

- Audience: maintainers and operators managing voice-alignment rollout.
- Read Time: 5 minutes.
- Authority Level: operations runbook.
- Last Verified Against: 2026-05-17 repo state.
- Owner: backend/ops maintainers + automation agents.
- Review Cadence: monthly or after voice-alignment workflow changes.
- Status: `runbook`.

## Purpose

Operational guide for rolling out and maintaining voice-alignment v2 safely across prompting,
validation, and TTS execution.

## Preconditions

- Node `24.11.1+`
- `pnpm` installed
- `ESL_TTS_PROVIDER_ELEVENLABS_API_KEY` configured
- Voice catalog path available (`ESL_TTS_PROVIDER_ELEVENLABS_VOICES_PATH` or default
  `packages/orchestrator/configs/elevenlabs.voices.json`)

## 1) Refresh Voice Catalog

1. Sync voices from provider:
   - One-time refresh: `pnpm voices:sync`
   - Long-running local refresher: `pnpm voices:sync:watch`
   - The watcher defaults to every 24 hours. Override with
     `ESL_ELEVENLABS_VOICES_SYNC_INTERVAL_HOURS=<hours>` or
     `pnpm voices:sync -- --watch --interval-hours <hours>`.
   - Both commands load canonical `.env` without overriding shell variables.
2. Confirm catalog was written:
   - Check `generatedAt` and `voices` in `packages/orchestrator/configs/elevenlabs.voices.json`
3. Commit updated catalog when intentional:
   - Include `generatedAt` change rationale in PR notes.

## 2) Verify Catalog Freshness

1. Validate JSON shape:
   - Top-level `voices[]`
   - Provider voice metadata required for runtime matching
2. Confirm catalog recency:
   - Compare `generatedAt` with expected refresh cadence.
3. Validate speech planning:
   - Confirm generated Markdown contains provider-neutral speaker profiles.
   - Confirm the orchestrator records `voice-plan` and `speech-plan` stages before `tts`.
   - For Inworld TTS-2, inspect `voicePlans.studyText` and `speechPlans.studyText` manifest
     provenance.
   - Confirm selected voices record whether free-form direction is supported. Every TTS-2 voice
     still supports metadata instructions, non-verbals, uppercase emphasis, breaks, and SDK
     controls; only voices tagged `steerable` support free-form natural-language direction.

## 3) Validation Progression Playbook

Progress flags in this order:

1. Shadow validation only:
   - `VOICE_ALIGNMENT_V2_ENABLED=true`
   - `VOICE_ALIGNMENT_V2_STRICT_VALIDATION=false`
   - Expected: non-blocking validation + `voiceDiagnostics.shadowMode` telemetry while the
     current homework prompt remains the default runtime.
2. Strict validation:
   - `VOICE_ALIGNMENT_V2_ENABLED=true`
   - `VOICE_ALIGNMENT_V2_STRICT_VALIDATION=true`
   - Expected: unsupported metadata diagnostics block publish flow only when strict validation is enabled.
3. Steady state:
   - `VOICE_ALIGNMENT_V2_ENABLED=true`
   - `VOICE_ALIGNMENT_V2_STRICT_VALIDATION=true`
   - Expected: the current homework prompt is selected and provider catalogs are resolved during
     TTS preparation rather than prompt packaging.

Rollback:

1. Disable strict first (`VOICE_ALIGNMENT_V2_STRICT_VALIDATION=false`).
2. If needed, disable v2 entirely (`VOICE_ALIGNMENT_V2_ENABLED=false`).
3. Prompt selection stays on the current homework snapshot; diagnose capability issues with
   validation controls rather than a prompt-selection flag.

## 4) Monitoring and Readiness Checks

Watch `/metrics/readiness`:

- `voiceAlignment.validationFailures`
- `voiceAlignment.strictMismatches`
- `voiceAlignment.providerErrors`
- `voiceAlignment.providerErrorBreakdown`
- `voiceAlignment.fallbackSelections` / `reuseSelections` (nullable until fully persisted)

Also watch metric streams/logs:

- `esl.voice_alignment.validation_failures`
- `esl.voice_alignment.shadow_mismatch`
- `esl.voice_alignment.shadow_mismatch_total`
- `esl.voice_alignment.provider_error`

## 5) Common Failures and Remediation

### Invalid voice override (`invalid_voice_id`)

1. Check explicit operator voice overrides in `voices.yml`, job flags, or provider settings.
2. Confirm the voice exists by id or catalog name in the current synced catalog.
3. Re-sync the catalog if the voice was recently changed in provider.

### Unsupported accent (`unsupported_voice_capability`)

1. Compare requested `accent` with the provider catalog selected at TTS preparation time.
2. Update stable profile metadata or operator routing configuration.
3. Re-run study-text TTS to produce fresh plan provenance.

### Strict quality guard no-match

1. Review speaker profiles for over-constrained attributes.
2. Relax style/accent/age where possible.
3. Optionally add explicit operator voice overrides for deterministic routing.

### Provider rate limit / timeout

1. Retry after cooldown.
2. Reduce concurrency/chunk size where feasible.
3. Monitor provider incident status before re-enabling strict rollout gates.

## 6) Deployment Checklist

1. `pnpm check:fast`
2. Validate one canary assignment in each mode:
   - compatibility shadow
   - strict validation
   - strict + active provider-neutral prompt
3. Confirm readiness endpoint and logs emit expected voice-alignment counters.
4. Document rollout decision and rollback condition in deployment notes.

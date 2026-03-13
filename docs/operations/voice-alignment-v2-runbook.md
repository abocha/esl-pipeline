# Voice Alignment V2 Runbook

## Meta

- Audience: maintainers and operators managing voice-alignment rollout.
- Read Time: 5 minutes.
- Authority Level: operations runbook.
- Last Verified Against: 2026-03-13 repo state.
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

## 1) Refresh Voice Catalog + Capability Snapshot

1. Sync voices from provider:
   - `pnpm --filter @esl-pipeline/tts-provider-elevenlabs exec node -e "import('./dist/src/index.js').then(async (m) => { const result = await m.syncVoices(); console.log(result); })"`
2. Confirm catalog was written:
   - Check `generatedAt` and `capabilities` in `packages/orchestrator/configs/elevenlabs.voices.json`
3. Commit updated catalog when intentional:
   - Include `generatedAt` change rationale in PR notes.

## 2) Verify Snapshot Freshness

1. Validate JSON shape:
   - Top-level `voices[]`
   - Top-level `capabilities` with `generatedAt`, `role`, `gender`, `age`, `accent`, `style`
2. Confirm snapshot recency:
   - Compare `capabilities.generatedAt` with expected refresh cadence.
3. Validate prompt packaging behavior:
   - Run a v4.4 prompt package generation and ensure capability placeholders are replaced.
   - Confirm prompt package response includes capability provenance metadata (generatedAt + hash).

## 3) Flag Progression Playbook

Progress flags in this order:

1. Shadow validation only:
   - `VOICE_ALIGNMENT_V2_ENABLED=true`
   - `VOICE_ALIGNMENT_V2_STRICT_VALIDATION=false`
   - `VOICE_ALIGNMENT_V2_PROMPT=false`
   - Expected: non-blocking validation + `voiceDiagnostics.shadowMode` telemetry.
2. Strict validation:
   - `VOICE_ALIGNMENT_V2_ENABLED=true`
   - `VOICE_ALIGNMENT_V2_STRICT_VALIDATION=true`
   - `VOICE_ALIGNMENT_V2_PROMPT=false`
   - Expected: voice metadata mismatches block publish flow.
3. Voice-aligned prompt:
   - `VOICE_ALIGNMENT_V2_ENABLED=true`
   - `VOICE_ALIGNMENT_V2_STRICT_VALIDATION=true`
   - `VOICE_ALIGNMENT_V2_PROMPT=true`
   - Expected: v4.4 prompt selected and capability enums injected at package time.

Rollback:

1. Disable strict first (`VOICE_ALIGNMENT_V2_STRICT_VALIDATION=false`).
2. If needed, disable v2 entirely (`VOICE_ALIGNMENT_V2_ENABLED=false`).
3. Keep `VOICE_ALIGNMENT_V2_PROMPT=false` while diagnosing prompt/capability issues.

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

1. Check `speaker_profiles[].voice` values in markdown frontmatter.
2. Confirm voice exists by id or catalog name in current synced catalog.
3. Re-sync catalog if the voice was recently changed in provider.

### Unsupported style/accent (`unsupported_voice_capability`)

1. Compare requested `accent`/`style` with current capability snapshot.
2. Update profile metadata to supported values.
3. Regenerate prompt package to ensure new capability block is injected.

### Strict quality guard no-match

1. Review speaker profiles for over-constrained attributes.
2. Relax style/accent/age where possible.
3. Optionally add explicit `speaker_profiles.voice` overrides for deterministic routing.

### Provider rate limit / timeout

1. Retry after cooldown.
2. Reduce concurrency/chunk size where feasible.
3. Monitor provider incident status before re-enabling strict rollout gates.

## 6) Deployment Checklist

1. `pnpm check:fast`
2. Validate one canary assignment in each mode:
   - compatibility shadow
   - strict validation
   - strict + v4.4 prompt
3. Confirm readiness endpoint and logs emit expected voice-alignment counters.
4. Document rollout decision and rollback condition in deployment notes.

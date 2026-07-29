# Speech-Planner Evaluation Gap Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Repository edits remain owned by the primary agent under `AGENTS.md`.

**Goal:** Make the speech-planner evaluation program production-faithful and decision-grade, rerun the Gemini 3.1 versus 3.5 comparison, and only then add `gpt-5.6-luna` as a provider-neutral contender.

**Architecture:** Separate remotely planned TTS-2 model-quality attempts from deterministic identity-model safety controls, reuse production routing and validation boundaries, and preserve fail-closed budget, privacy, artifact, and accounting contracts. Provider-specific execution remains behind explicit adapters while parsing, plan analysis, reporting, and listening selection stay shared.

**Tech Stack:** TypeScript, Vitest, Google AI Studio structured generation, OpenAI Responses, `tts-core`, batch-backend evaluation CLI, Inworld TTS selected-audio synthesis.

## Meta

- Audience: primary implementation agent and reviewers.
- Authority Level: active implementation plan.
- Last Verified Against: 2026-07-29 repo state at `8a752a314e97d4b4e49dee8568e13f96ba28a885`.
- Owner: backend and TTS maintainers.
- Review Cadence: after each risk boundary below or when live evidence changes the design.
- Status: `active`.
- Current Focus: repair evaluator fidelity and accounting before any additional model comparison.
- Exit Trigger: archive after the remediation PR and corrected evidence PR merge and durable behavior is represented in the runbook/reference docs.

## Global Constraints

- Preserve the production default `gemini-3.1-flash-lite` until corrected automatic and human
  evidence supports a separate configuration decision.
- Do not change production TTS rendering, retry, cache, manifest, or speaking-rate policy merely to
  make an evaluation green.
- Keep the public live comparison fixed and bounded. Do not silently raise harness daily/RPM limits
  or provider spend.
- Never commit live raw outputs, audio, private learner text, credentials, environment dumps, or the
  ignored original-issue fixture.
- Tests must fail for the expected reason before implementation. Run `pnpm test:check-routing`
  before canonical unit execution and follow current `agents-ssot` routing.
- Human listening results must come from the user; never infer or fabricate them.
- A Luna comparison is a later stage, not part of the harness-fidelity repair and not permission to
  change any default.

---

## Task 1: Lock the live-run evidence into regression fixtures

- [ ] Add the synthetic `warm-laugh` 3.1/v2 raw response to
      `packages/batch-backend/fixtures/speech-planner-eval/planner-outputs-v1.json`, preserving the exact
      unsafe cue without provider identifiers or timestamps.
- [ ] Add focused cases in
      `packages/batch-backend/tests/application.speech-performance-planner.test.ts` and
      `packages/batch-backend/tests/application.speech-planner-evaluator.test.ts` that reproduce the
      `unsafe_cue_text` fallback and distinguish it from a malformed provider response.
- [ ] Add a normalized transient-provider record fixture for `UNAVAILABLE` without copying request
      IDs or raw provider messages.
- [ ] Confirm the fresh tests fail because the current fixture set cannot reproduce the observed
      cases, then commit only synthetic regression material and tests.

Focused validation:

```powershell
pnpm test:check-routing
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.speech-performance-planner.test.ts tests/application.speech-planner-evaluator.test.ts
```

## Task 2: Make the live matrix follow production planning-mode routing

- [ ] Add a failing test in
      `packages/batch-backend/tests/application.speech-planner-eval-fixtures.test.ts` proving every paid
      model-quality fixture selects a TTS model whose `planningMode` is `prompted`.
- [ ] Add a failing evaluator/CLI test proving an identity-only TTS model performs zero remote
      planner calls and is evaluated through the same identity-plan decision used by
      `packages/orchestrator/src/runtime/speech-performance.ts`.
- [ ] Replace `tts-1-5-protection` in the paid ten-fixture public matrix with a synthetic prompted
      TTS-2 safety fixture so the public baseline remains 10 x 2 x 2 x 3 = 120 provider attempts.
- [ ] Move TTS 1.5 protection into a deterministic zero-provider control suite. Reuse
      `getTtsModelCapabilities()` and `createIdentitySpeechPerformancePlan()` rather than duplicating
      capability policy in the CLI.
- [ ] Record control-suite results separately from model-quality cells in `run.json`,
      `summary.json`, and `summary.md`. The aggregate may pass only when both suites pass, but identity
      controls must not be attributed to a planner model or prompt.
- [ ] Prove no Postgres adapter, Gemini client, OpenAI client, or Inworld client is constructed by
      deterministic control execution.

Primary files:

- `packages/batch-backend/src/application/speech-planner-eval-fixtures.ts`
- `packages/batch-backend/src/application/speech-planner-evaluator.ts`
- `packages/batch-backend/src/application/speech-planner-eval-report.ts`
- `packages/batch-backend/src/tools/eval-speech-planner.ts`
- `packages/batch-backend/fixtures/speech-planner-eval/corpus-v1.json`
- `packages/orchestrator/src/runtime/speech-performance.ts` (reuse boundary; avoid behavior change)

Focused validation:

```powershell
pnpm test:check-routing
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.speech-planner-eval-fixtures.test.ts tests/application.speech-planner-evaluator.test.ts tests/tools.eval-speech-planner.test.ts
pnpm --filter @esl-pipeline/orchestrator exec vitest run tests/runtime.speech-performance.test.ts
pnpm eval:speech-planner -- --offline-output-fixtures=packages/batch-backend/fixtures/speech-planner-eval/planner-outputs-v1.json
```

## Task 3: Clarify parser safety and transient-provider semantics

- [ ] Reproduce the synthetic `warm-laugh` 84-code-point `intonation` value against the 80-code-point
      cap and add a specific privacy-safe diagnostic instead of collapsing the cause into generic
      `unsafe_cue_text`.
- [ ] Keep NFKC normalization, control-character rejection, brackets/tag delimiters, authored-word
      preservation, and one-nonverbal cap intact. Change the grammar only with a narrow red/green test
      proving ordinary safe prose is rejected today.
- [ ] Trace the 3.1 `UNAVAILABLE` attempt through
      `packages/batch-backend/src/application/generation-providers.ts` and the planner retry owner.
      Preserve the one-logical-retry-owner contract; do not add SDK plus application retry stacking.
- [ ] Make reports distinguish provider availability failures from schema/parser failures and show
      whether a retry was attempted, without persisting provider messages or learner text.
- [ ] Add deterministic tests for no-retry deterministic failures and bounded retryable failures.

Focused validation:

```powershell
pnpm test:check-routing
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.generation-providers.structured-output.test.ts tests/application.speech-performance-planner.test.ts tests/application.speech-planner-evaluator.test.ts
```

## Task 4: Resolve thinking-token and cost-reporting truthfully

- [ ] Verify the current Google usage contract for `promptTokenCount`, `candidatesTokenCount`,
      `thoughtsTokenCount`, and `totalTokenCount` against official documentation and one privacy-safe
      captured response shape.
- [ ] Add parser tests in
      `packages/batch-backend/tests/application.generation-providers.structured-output.test.ts` for
      reported thoughts, explicitly reported zero, absent thoughts with reconcilable totals, and absent
      thoughts with ambiguous totals.
- [ ] Keep `estimateSpeechPlannerAttemptCost()` unavailable when output-billed tokens cannot be
      proven. If zero can be inferred from an official invariant, record `inferred_zero` provenance;
      otherwise report known input/output components or a labeled bound without presenting an exact
      total.
- [ ] Extend report tests so every estimated amount exposes candidate-plus-thinking arithmetic and
      every unavailable amount exposes the missing field reason.
- [ ] Refresh the checked-in versioned price snapshot only from official provider pricing and record
      its retrieval date.

Focused validation:

```powershell
pnpm test:check-routing
pnpm --filter @esl-pipeline/batch-backend exec vitest run tests/application.generation-providers.structured-output.test.ts tests/application.speech-planner-evaluator.test.ts
```

## Task 5: Calibrate quality warnings without weakening hard gates

- [ ] Break down `redundant_instruction_components` and `high_cue_density` by fixture, field pair,
      model, and prompt using offline records.
- [ ] Add report tests proving warning counts refer to model-controllable behavior and do not
      double-count the same semantic control.
- [ ] Decide from evidence whether to revise the v2 prompt, warning definitions, or both. Any prompt
      edit requires a new immutable prompt-policy ID/hash; never rewrite v2 in place.
- [ ] Keep warnings comparative. Do not promote a warning to a hard gate without a documented
      provider-safety or learner-quality invariant.

Primary files:

- `packages/batch-backend/src/application/speech-performance-prompt.ts`
- `packages/tts-core/src/speech-plan-analysis.ts`
- `packages/batch-backend/src/application/speech-planner-eval-report.ts`
- their existing focused tests

## Task 6: Re-run the corrected Gemini baseline and listening program

- [ ] Complete dry-run and offline fixtures first; verify the matrix remains exactly 120 paid
      attempts plus zero-provider deterministic controls.
- [ ] Obtain a complete current-day project request count, verify both stable Gemini IDs are
      allowlisted, and fail closed unless all missing attempts fit the configured local daily/RPM caps.
- [ ] Run the corrected 3.1 versus 3.5 live matrix once. Record a new run ID and a committed
      non-private dated evidence summary; never overwrite the 2026-07-29 record.
- [ ] If and only if automatic gates pass, generate the complete paired selected-audio blocks.
- [ ] Ask the user to perform blind listening, record their actual ratings, then unblind. Do not
      claim preference evidence before this step.
- [ ] Run the separate private fixture only if the ignored file exists. Otherwise retain exactly:
      `Original issue fixture unavailable; record that limitation before closeout.`

## Task 7: Add Luna as a provider-neutral contender

- [ ] Start only after Task 6 produces trustworthy corrected Gemini evidence.
- [ ] Write and review a bounded Luna comparison design before implementation. Define the exact
      stable model ID, OpenAI Responses structured-output request, reasoning effort, compatibility
      smoke, current-day budget source, RPM limiter, price snapshot, retry ownership, returned-model
      identity, and accounted call count.
- [ ] Replace the Gemini-only model union with an explicit provider/model variant while keeping one
      shared parser, plan analyzer, report schema, artifact privacy contract, and listening selector.
- [ ] Add provider-specific preflight adapters; never make a Google quota observation authorize
      OpenAI spend or vice versa.
- [ ] Compare Luna against the best corrected Gemini production-policy cell on the same prompted
      corpus and repetitions. Keep provider latency and cost labeled as descriptive and provider-specific.
- [ ] Require the same automatic hard gates and paired blind listening before considering Luna for a
      default decision.

Likely files:

- `packages/batch-backend/src/application/speech-planner-eval-fixtures.ts`
- `packages/batch-backend/src/application/speech-planner-evaluator.ts`
- `packages/batch-backend/src/tools/eval-speech-planner.ts`
- `packages/batch-backend/src/application/generation-providers.ts`
- `packages/batch-backend/src/application/openai-responses-contract.ts`
- `docs/operations/speech-planner-evaluation.md`

## Task 8: Validation, review, and decision boundary

- [ ] Run format, repo hygiene, docs checks, package builds/typechecks, offline dry-run, and the
      canonical broad gate selected by current test routing. This work is cross-cutting, so use
      `pnpm check:pre-pr` unless the final diff is materially narrower.
- [ ] Review harness/control separation, shared parsing, cost math, resumability, privacy, fair
      provider comparison, and listening blocks before any default conclusion.
- [ ] Record local `PASS`, `PASS_WITH_CI_REQUIREMENTS`, provider-eval results, human-input gaps, and
      CI-owned service requirements separately.
- [ ] Retain `gemini-3.1-flash-lite` and current TTS defaults if results are mixed, incomplete, or
      missing human/private evidence. Any default change is a separate reviewed configuration change.

Canonical validation target:

```powershell
pnpm format:write
pnpm format
pnpm run lint:repo-hygiene
pnpm docs:check
pnpm test:check-routing
pnpm check:pre-pr
```

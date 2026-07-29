# Speech-Planner Evaluation

## Meta

- Audience: maintainers and operators evaluating speech-planner models or prompt policies.
- Read Time: 6 minutes.
- Authority Level: operator runbook.
- Last Verified Against: 2026-07-29 repo state.
- Owner: backend and TTS maintainers.
- Review Cadence: after speech-planner model, prompt, renderer, or evaluation-contract changes.
- Status: `active`.

## Purpose and Safety Boundary

`pnpm eval:speech-planner` compares the exact stable Gemini 3.1 and 3.5 Flash-Lite IDs against a
checked-in synthetic corpus. It is database-free: the CLI injects an evaluation-owned request-budget
repository and never resolves a Postgres adapter. No flags means dry-run only. Live Gemini and
selected Inworld audio always require explicit flags and valid credentials.

Artifacts are local under `tmp/speech-planner-eval/` and are ignored by Git. They can contain raw
planner output, rendered synthetic text, provider request IDs, audio, and a blind-review key. Never
commit them, credentials, environment dumps, a private fixture, or raw private learner text.

## Offline and Dry Runs

Run the production parser, validator, renderer, metrics, and report writer against checked-in raw
outputs without constructing Gemini, Inworld, Postgres, or a budget repository:

```powershell
pnpm eval:speech-planner -- --offline-output-fixtures=packages/batch-backend/fixtures/speech-planner-eval/planner-outputs-v1.json
```

Inspect the fixed public matrix without provider calls:

```powershell
pnpm eval:speech-planner -- --models=gemini-3.1-flash-lite,gemini-3.5-flash-lite --prompts=speech-performance-v1-restrained-natural,speech-performance-v2-inworld-tts2 --repetitions=3
```

The paid public baseline is exactly 10 prompted TTS-2 fixtures x 2 models x 2 prompts x 3
repetitions = 120 physical planner requests with zero automatic retries. A separate checked-in
TTS 1.5 control suite follows production identity routing, exercises the real deterministic renderer
and analyzer, and performs zero provider requests. Its results are not attributed to a planner model
or prompt. The first Gemini 3.5 cell is the compatibility smoke. The dry run reports configured
daily/RPM limits, remaining capacity, current-day usage as unverified, and the exact required
allowlist state. A missing model is reported as remediation without blocking dry-run inspection; it
remains fatal before any live provider construction.

## Live Preflight and Baseline

Before a live run, obtain the provider's complete current-day request count. Do not infer zero and do
not omit unrelated requests made earlier that day. Both exact stable IDs must already be present in
`GEN_ALLOWED_MODELS_GOOGLE`; the full requested matrix must fit the existing
`ESL_TTS_SPEECH_PLANNER_DAILY_REQUEST_BUDGET`; and the configured RPM must be positive. The CLI fails
closed and prints remediation. It never raises or bypasses those limits.

```powershell
$currentGeminiRequestsToday = [int](Read-Host 'Current Gemini requests used today')
pnpm eval:speech-planner -- --live --used-today=$currentGeminiRequestsToday --models=gemini-3.1-flash-lite,gemini-3.5-flash-lite --prompts=speech-performance-v1-restrained-natural,speech-performance-v2-inworld-tts2 --repetitions=3
```

The renewable rolling RPM limiter determines the minimum duration. At 4 RPM, 120 calls take roughly
30 minutes. The harness records an immutable privacy-safe call intent before each live request and
counts the physical request once, including provider failures. It never retries a baseline request.
A Gemini 3.5 compatibility failure short-circuits its remaining cells and records derived skips
instead of spending the rest of that model's matrix.

If interrupted, obtain a fresh current-day count and resume the exact printed directory:

```powershell
pnpm eval:speech-planner -- --live --used-today=$currentGeminiRequestsToday --resume-run="tmp/speech-planner-eval/<run-id>"
```

Resume reconstructs the saved corpus, exact model/prompt matrix, repetitions, price snapshot, and
private/offline mode from `run.json`; custom flags do not need to be repeated. It verifies the
immutable configuration, fixture, and control hashes, preflights only missing attempt IDs, and
appends them. It refuses mismatched or overwritten artifacts. If a call-intent, plan, or rendered
artifact exists without its completed attempt record, resume fails closed as an indeterminate
physical request and does not call the provider again.

Schema 4 `run.json` records the resolved mode and paths, exact variants, non-secret environment flags,
allowlist and configured-limit preflight facts, complete versioned price snapshot, source revision,
prompt and renderer identities, expected/completed paid attempt counts, and separate stable control
IDs, hashes, and expected/completed counts. Immutable per-control evidence lives under `controls/`;
privacy-safe physical-call intents live under `calls/`. Status is `partial` while either suite is
incomplete and changes atomically to `completed` only after both suites and summaries are written.
Every planner resume appends its fresh preflight and physical provider-call count as an activity;
selected-audio attempts append their own partial/completed/failed activity and synthesis count. A
failed audio continuation returns the overall run to `partial` until a later successful recovery.
Provider credentials and environment dumps are never recorded.

## Selected Audio and Blind Review

After automatic hard gates pass, selected audio requires an Inworld credential and the same fresh
Gemini usage count even though a complete resumed run should make zero new planner calls:

```powershell
pnpm eval:speech-planner -- --live --audio=selected --used-today=$currentGeminiRequestsToday --resume-run="tmp/speech-planner-eval/<run-id>"
```

The harness synthesizes paired four-cell blocks with the recorded Inworld model, voices, renderer
output, sample rate, and assembly gaps. It selects neutral, explicitly non-natural pace, high-cue,
renderer-failure, and metric-disagreement cases when present. Incomplete blocks are marked ineligible
for pairwise preference. Review `listening/index.html` without opening `listening/key.json`, record
naturalness, ESL clarity, appropriateness, pacing, unwanted pauses, spoken control text, and overall
preference, then unblind. Human ratings must never be fabricated.

## Private Original-Issue Fixture

The optional ignored fixture may exist only under
`tmp/speech-planner-eval-private/issue-154.json`. Run it separately; it never changes the fixed public
baseline:

```powershell
pnpm eval:speech-planner -- --live --private-only --private-fixture=tmp/speech-planner-eval-private/issue-154.json --used-today=$currentGeminiRequestsToday --models=gemini-3.1-flash-lite,gemini-3.5-flash-lite --prompts=speech-performance-v1-restrained-natural,speech-performance-v2-inworld-tts2 --repetitions=1
```

If the file is absent, record exactly: `Original issue fixture unavailable; record that limitation before closeout.`

## Interpretation and Closeout

Use `summary.json` and `summary.md` to distinguish raw parse validity from identity fallback and to
compare hard failures, warnings, latency, returned model identity, and estimated cost. Warning
breakdowns are evaluator-only comparative evidence by fixture, field pair, and model/prompt cell;
the harness deduplicates the same semantic warning across raw-candidate and validated analysis. Cost is
available only when input, visible candidate output, and thinking-token counts are all present; the
formula prices candidate plus thinking tokens at the output rate from the versioned snapshot. When
Google omits a thinking count, the report preserves known input/output components and names the
missing field rather than inferring zero or presenting an exact total.

Authored-word preservation, supported controls, renderer safety, and compatibility are hard gates.
Cost, latency, and blind preference are comparative evidence. Mixed, incomplete, compatibility-
skipped, private-fixture-missing, or human-review-missing results retain `gemini-3.1-flash-lite` and
the existing TTS defaults. A default change is a separate evidence-backed configuration decision.

## Recorded Evidence and Active Remediation

The first complete live public baseline is recorded in
[`speech-planner-evaluation-evidence-2026-07-29.md`](speech-planner-evaluation-evidence-2026-07-29.md).
It found a promising Gemini 3.5 production-policy signal, but also proved that the live matrix was
not production-faithful for identity-only TTS 1.5. Production skips remote planning for identity
models; the harness called the planner and attributed the resulting unsupported controls to model
quality. Do not use that aggregate red gate to infer a production TTS 1.5 regression.

The active repair sequence is
[`../plans/2026-07-29-speech-planner-evaluation-gap-remediation.md`](../plans/2026-07-29-speech-planner-evaluation-gap-remediation.md).
The harness-fidelity implementation repairs this routing mismatch, physical-call accounting,
diagnostics, and cost/reporting gaps before rerunning Gemini. It deliberately keeps both immutable
prompt policies and the shared production warning definitions unchanged so the corrected comparison
isolates harness fidelity. A provider-neutral
`gpt-5.6-luna` comparison follows only after corrected Gemini evidence and does not itself authorize
a default change.

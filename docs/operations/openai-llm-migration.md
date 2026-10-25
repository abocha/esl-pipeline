# OpenAI LLM migration (ESL-41)

## Meta

- Audience: maintainers and deployment operators.
- Authority Level: migration inventory and rollout checklist.
- Last Verified Against: 2026-10-10 main including ESL-38/39/40 and read-only production settings.
- Owner: founder-maintainer + backend maintainers.
- Status: `active`.

## Workload inventory

The source trace covers runtime adapters, worker wiring, HTTP/operator overrides, maintenance CLI,
env/templates/Compose and budgets. A read-only inventory of the server env and all five backend
containers found image `2033535e058bf33f0e53b17698eba8f1ce4fb94e`. These are configured targets,
not traffic measurements. OpenAI, Gemini and OpenRouter credentials are present; no values were
exported. No production mutation or paid request occurred.

| Workload / entrypoint                                                                                                | Before (configured production / explicit alternate)                   | After / rationale                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Assignment drafts / correction generation                                                                            | OpenAI `gpt-6.1-sol`; unsupported assignment overrides already reject | Keep Sol 6.1: strict AssignmentV1, pedagogical generation and validation                                               |
| Lesson/homework extraction, refresh and queued replay                                                                | OpenAI `gpt-5.6-luna`; Google Gemini and OpenRouter explicit adapters | OpenAI `gpt-5.6-luna`: bounded evidence extraction; same schema, medium/low envelope settings                          |
| Full/incremental snapshot generation                                                                                 | OpenAI `gpt-5.6-luna`; Google/OpenRouter explicit adapters            | OpenAI `gpt-5.6-luna`: structured rollup; retain high reasoning, low verbosity                                         |
| Profile refresh/drafting, candidate promotion, initial enrichment, legacy normalization                              | OpenAI `gpt-5.6-luna`; Google/OpenRouter explicit adapters            | OpenAI `gpt-5.6-luna`: bounded structured evidence/patch; retain medium/low envelopes and prompt-only enrichment       |
| Inworld semantic voice ranking                                                                                       | Enabled Google AI Studio `gemma-4-31b-it`                             | OpenAI Responses `gpt-5.6-luna`: bounded shortlist selection, low reasoning/verbosity, strict JSON, 1200 output tokens |
| Study-text speech planning                                                                                           | Enabled OpenAI `gpt-5.6-luna`; Google explicit override               | OpenAI `gpt-5.6-luna`; preserve enablement, identity recovery and same-target timeout retries                          |
| `refresh-student-lesson-history`, `refresh-homework-memory`, `refresh-student-memory-snapshots`, legacy-profile tool | Workload resolver plus Google/OpenRouter CLI overrides                | OpenAI only, using the workload above; explicit OpenAI model overrides remain                                          |
| Generation fixture evaluator / default-off OpenAI Batch                                                              | Existing explicit OpenAI lane                                         | Keep OpenAI; active fixture requests use Luna 5.6 / Sol 6.1; Batch gate remains false                                  |
| Historical Gemini speech-evaluation CLI                                                                              | Optional live Gemini 3.1/3.5 Flash-Lite matrix                        | Retire live execution; preserve dry-run, raw offline outputs, price snapshots and reports                              |

All Google/OpenRouter generation HTTP functions, parsing helpers, credential/model/limit config and
active selection rosters are removed. No GenAI SDK dependency exists in the current workspace;
the retired adapters used raw HTTP. Google Cloud STT/TTS SDKs/service-account settings are still
used and retained. OpenRouter has no configured production workload and can be retired with the
unused alternate adapters. Historical provider strings, request evidence, SQL/schema constraints
and completed artifact provenance are unchanged. Credential scrubbing in no-provider test/smoke
environments remains intentional. ABO-33's Gemini TTS proposal is deferred under ESL-41's approved
direction; no Gemini TTS implementation is included.

API 11 marks removal of fresh Google/OpenRouter request admission. DB, manifest, prompt and
validator contracts are unchanged. Pending work keeps its frozen target: old OpenAI jobs may
complete with their pinned model; retired-provider jobs fail before budget reservation/dispatch
with an explicit contract error. Neither deploy nor retry rewrites targets or historical data.

## Alpha model decision

The 2026-10-10 maintainer decision in [ESL-41](https://linear.app/abocha/issue/ESL-41/migrate-all-google-ai-studio-llm-workloads-to-openai)
retains 5.6 Luna for bounded workloads and speech planning, and selects it for migrated voice ranking.
There is no measured quality advantage warranting a Luna 6 upgrade in this migration. The supplied
operating premise is Build data-sharing headroom of 2.5M tokens/day for the 5.6 Luna group versus
250k/day for Luna 6, shared with each group's listed models. This is a temporary alpha decision;
account eligibility, enrollment and actual complimentary usage remain dashboard-verified inputs,
not guaranteed free capacity or hardcoded application budgets.

No organization/project sharing settings or learner-data permissions change here. Sharing learner
transcripts/profiles requires appropriate rights and may be unsuitable for identifiable/sensitive
content. Review project separation and sharing policy before multi-tutor/customer rollout; no
historical provenance or retention change follows from this routing decision.

## Decisions `choice` assessment

[Official Decisions guidance](https://developers.openai.com/api/docs/guides/decisions) on 2026-10-10
specifies `POST /v1/decisions`, Luna 6 only, named `choice` questions, distinct
`choices: [{value, description}]`, and named typed answers with `choice`, confidence and
probabilities, or refusal. JavaScript SDK support starts at 7.30.0; this repository uses raw HTTP
and has no OpenAI SDK. The API is public beta. The reference endpoint's generated TypeScript
example lookup returned no method examples; the official guide supplies the SDK/request contract.

Five small synthetic catalog cases were checked through the actual Responses ranker/catalog
boundary. The Decisions column is a contract comparison, not model-quality or latency evidence:

| Case                                             | Responses / deterministic catalog result   | Decisions consequence                                                          |
| ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------ |
| Two speakers with overlapping A/B/C shortlists   | Joint C/A selection; one call              | Independent questions may both select A; no joint constraint                   |
| Both speakers select A despite alternatives      | Reject ranking; deterministic A/B          | Requires the same collision recovery, or dependent sequential requests         |
| Maya explicitly mapped to A                      | Mapping stays A; rank only Leo, yielding B | Still needs application-owned mapping exclusion and collision checks           |
| Provider failure / missing or invalid selections | Existing deterministic A/B recovery        | Refusal, missing named answers and transport failures need equivalent recovery |
| Both speakers have only A                        | Reuse A when exhausted                     | Choice API cannot create a second eligible voice                               |

The guide says dependent questions require separate requests. Keeping Responses preserves one
joint request, existing structured parsing, usage and timeout behavior without a second adapter,
SDK or decision framework. Documented speed/input-only billing is promising but was not measured
here. No demonstrated benefit justifies switching transports in this migration. Live quality,
latency and cost comparisons remain separately authorized; mocks do not establish model quality.

The maintainer's revised alpha target is `gpt-5.6-luna`, which is outside the documented
Decisions model contract. This independently supports keeping Responses; the representative wire,
shortlist, mapping, uniqueness and failure checks use 5.6 Luna without paid evaluation.

## Combined rollout checklist

This is preparation only. Deploy the complete CI-published release bundle containing ESL-38
[#371](https://github.com/abocha/esl-pipeline/pull/371), ESL-39
[#374](https://github.com/abocha/esl-pipeline/pull/374), ESL-40
[#381](https://github.com/abocha/esl-pipeline/pull/381), and ESL-41 after all required merge gates
pass and separate production authorization is granted.

1. Save the current immutable image bundle and restricted environment snapshot. Quiesce new
   generation and workers; inspect pending/active targets by metadata only. Drain or disposition
   retired-provider jobs under separate operator authority before removal. Do not mass rewrite
   pending rows, replay historical extraction, or retry source-less candidate jobs. ESL-38 verified
   historical observations remain readable; ESL-39 source-bound candidates keep their review state.
2. Retain `OPENAI_API_KEY`. Set all five `GEN_<WORKLOAD>_PROVIDER` values to `openai`, keep
   `GEN_ASSIGNMENT_MODEL=gpt-6.1-sol`, set `GEN_LESSON_MEMORY_MODEL`, `GEN_HOMEWORK_MEMORY_MODEL`,
   `GEN_STUDENT_MEMORY_SNAPSHOT_MODEL`, `GEN_PROFILE_DRAFT_MODEL` and `GEN_OPENAI_MODEL` to
   `gpt-5.6-luna`. Set `GEN_ALLOWED_MODELS_OPENAI=gpt-5.6-luna,gpt-6.1-sol` (retain intentional
   OpenAI roster entries required by pinned jobs). Set `ESL_TTS_VOICE_RANKER_MODEL=gpt-5.6-luna`,
   `ESL_TTS_SPEECH_PLANNER_PROVIDER=openai`, `ESL_TTS_SPEECH_PLANNER_MODEL=gpt-5.6-luna`.
   Preserve currently enabled ranker/planner flags and `STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false`.
3. Remove from the operator environment, only under credential-removal authority:
   `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_X_TITLE`,
   `GEN_ALLOWED_MODELS_GOOGLE`, `GEN_ALLOWED_MODELS_OPENROUTER`, and all existing
   `GEN_GOOGLE_*` / `GEN_OPENROUTER_*` settings (model, timeout, retry, RPM, daily requests/tokens,
   including obsolete primary/fallback/tertiary variables). Compose still loads the operator `.env`; obsolete variables are ignored by the new runtime.
   Keep Cloud STT/TTS service-account files, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_STT_*`,
   `ESL_STT_*`, `ESL_TTS_PROVIDER_*`, ElevenLabs, Deepgram and Inworld credentials unchanged.
4. Deliberately approve account capacity for the moved traffic. Current local OpenAI settings are
   `GEN_SAFETY_MODE=hard_stop`, RPM 3, TPM 160000, daily requests 40 and daily tokens 120000,
   keyed per provider/model. Keep the 12000 output hard cap, request timeout and independent
   planner/ranker request limits. Consolidated Luna traffic includes ranking and memory; do not
   silently raise limits. Use the OpenAI dashboard as account-level truth.
5. Validate the translated env with the production profile. Run
   `sudo bash /opt/esl-pipeline/scripts/deploy/deploy-prod-images.sh <40-char-release-sha> --plan`,
   then the same command without `--plan` under deploy authority. Use the standard
   [immutable-image deployment](../backend-frontend/DEPLOYMENT.md); migration/backup behavior stays
   owned by that script. These four PRs introduce no new SQL migration. Resume workers deliberately.
6. Verify health and `/meta/version` (API 11), deployed image SHAs, API and every worker's effective
   targets, OpenAI-only generation choices and retained STT/TTS settings. Observe separately
   authorized normal work: AssignmentV1/schema validation, Luna request IDs/usage, voice selection
   and deterministic recovery, rate-limit same-job deferral and eligible snapshot publication.
   Check ESL-38 availability/continuity and ESL-39 source-bound candidate selection. No backfill or
   paid smoke call is implied. Confirm no new `google_ai_studio`/Gemini/Gemma generation events or
   Google AI Studio dashboard usage after the cutoff; historical rows are not new traffic.

## Rollback checklist

1. Quiesce intake/workers and retain new job/result evidence if quality, schemas, capacity or
   continuity regress. Do not retarget failed/frozen jobs or rewrite completed artifacts.
2. For Luna quality only, explicitly select the previously approved OpenAI model for the affected
   workload; it remains an operator override. The ranker can be disabled to use deterministic
   selection. Google cannot be re-enabled on this image.
3. For application rollback, restore the saved previous environment and complete previous image
   bundle together via the standard immutable-SHA deploy procedure. Old images may need the saved
   Gemini/OpenRouter secrets; keep a restricted rollback copy until the rollout is accepted.
   Credential deletion/revocation must account for this window. No database restore or migration
   reversal is required by these PRs; any data restore needs separate authority and reconciliation.
4. Verify health, image/contract versions, matched env, preserved history and durable queue state
   before reopening intake. Record separately whether runtime rollout and traffic/quality checks
   actually occurred.

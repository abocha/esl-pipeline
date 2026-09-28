# Backend-Frontend Alignment (Status Tracker)

## Meta

- Audience: AI agents and maintainers coordinating backend/frontend delivery.
- Read Time: 3 minutes.
- Authority Level: Canonical status tracker.
- Last Verified Against: 2026-09-26 first-profile onboarding implementation.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: weekly while alpha work continues.
- Status: `active`.

## Purpose

Record which shared product capabilities are live and where their current boundary is. This is not a
feature history, route catalog, or backlog.

## Canonical Sources

1. [`docs/reference/agents-ssot.md`](../reference/agents-ssot.md)
2. [`docs/backend-frontend/BATCH_SYSTEM.md`](BATCH_SYSTEM.md)
3. Package README for the touched surface

Provider/model detail stays in
[`docs/reference/GENERATION_PROVIDER_POLICY.md`](../reference/GENERATION_PROVIDER_POLICY.md).

## Capability Matrix

| Surface                                | Status                        | Current boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assignment builder                     | Live                          | Five tutor-owned confirmed steps: Student, Lesson source, Teaching context, Create, Review & share. Automatic recovery is distinct from confirmation; readiness and navigation never advance confirmed truth. Explicit source attachment atomically claims the classified source fingerprint with recovery pointers or reopens its current owner. Ownership lasts through working replacement and transfers only when the replacement confirms. Completed post-cutover jobs reopen retained confirmed steps read-only, while pre-cutover jobs remain output-only. New/resume entry states remain mutually exclusive, with four recent lineages initially and progressive older loading. |
| Lesson sources                         | Live; rollout gates remain    | Supported direct audio and allowlisted cheap-demux video converge with tutor-pasted transcripts on the same workspace-owned workflow. Browser/backend size checks, deterministic media rejection, automatic bounded STT recovery, canonical poll/SSE/resume state, cache-hit `not_retained` lineage, and immediate post-confirmation audio unavailability are implemented. Manual transcripts bypass STT. Representative conferencing-export compatibility and the real presigned-S3 provider smoke remain rollout evidence, not current broad compatibility claims.                                                                                                                    |
| Draft, publish, and post-share actions | Live                          | Sessions own revision-CAS recovery plus immutable confirmed URI/hash/version snapshots; jobs own materialized runs. Share reserves one stable job identity and `confirmedStep = 'share'` is terminal without session archival. Failed/queued unpublished roots retry that identity and frozen snapshot; correction requires a succeeded HTML publication parent with a non-empty URL. Correction mode publishes the exact saved mutable draft through a stable child request; `Republish published version` remains the historical frozen-output action. Historical handouts remain readable; intentional reruns remain child jobs.                                                     |
| Student workspace and schedule         | Live                          | Directory, overview, learning, history, scheduling/billing, lesson completion, and lesson-linked homework entrypoints are available. Product evolution remains roadmap-driven.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Business schedule, stats, and settings | Live                          | Recorded payments, lesson/workload facts, bounded default-rate completed and scheduled lesson values, credit watch, reminders, and lesson actions are supported. Monetary lesson values are default-rate approximations, not accounting or revenue truth; recent payment records retain their currencies while monthly aggregates use the configured currency only. No predictive or risk-adjusted forecasting, per-student pricing, currency conversion, invoicing, or accounting is claimed.                                                                                                                                                                                          |
| Student memory and profile review      | Live with operator safeguards | Incremental refresh uses the latest eligible ready snapshot, with lesson-source ownership/readiness/provenance revalidated at canonical reads. The backend student-memory worker owns lesson-memory, homework-memory, and snapshot work; the frontend exposes health, candidate, and profile review while full rebuild remains CLI-only. Health inspection, candidate-delivery state and snapshot-ID retry, unavailable-vs-absent provenance, and deterministic profile diffs are supported.                                                                                                                                                                                            |
| Generation and safety policy           | Live                          | GPT-5.6 workload defaults are active in code; explicit overrides, provider budgets, eval gates, and disabled-by-default Batch replay remain authoritative controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Audio regeneration                     | Live                          | Family selection and clip reuse follow orchestrator and speech-performance contracts; the frontend exposes capability-gated actions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Telegram operations                    | Live internal surface         | The separate bot package provides allowlisted status, browsing, share, backup, drill, and approval operations over backend APIs. It is not a batch-frontend feature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Current Focus

- The read-only ChatGPT MCP resource is implemented behind disabled-by-default `MCP_OAUTH_ENABLED`.
  It exposes only learner name lookup and canonical teaching context; production activation and
  ChatGPT account connection are pending.
- Use production observations and tutor reports to select work from
  [`docs/plans/2026-06-23-alpha-readiness.md`](../plans/2026-06-23-alpha-readiness.md).
- Treat reproduced reliability or workflow failures as priority evidence.
- Known provider-account unavailability is a durable provider-neutral recording terminal state with
  operator guidance across polling, SSE, and resume; it does not invite replacement audio or another
  BullMQ delivery after the run commits.
- Keep speculative roadmap items in their plan; do not add them to this status matrix until a shared
  capability boundary changes.

## Assignment Workflow Boundary

- The API `4.0.0` / DB `0.23.0` cutover is the historical assignment-contract boundary that removes
  revisionless assignment, transcript, and draft mutations. Pre-cutover sessions, drafts, and prompt
  packages are deleted without compatibility or fabricated confirmation; completed jobs, handouts,
  URLs, rerun lineage, and required markdown storage remain read-only history. Current API, DB, and
  migration pins are machine-owned by [`packages/contracts/src/contract-versions.ts`](../../packages/contracts/src/contract-versions.ts),
  so the historical values in this paragraph are not the latest contract versions.
- Session recovery and confirmation use session revision CAS. Transcript/draft recovery use working
  version CAS and content-addressed objects. Confirmed Source/Create snapshots hold the server-owned
  immutable URI, hash, and working version directly; no content-revision tables exist.
- Canonical lesson-source ownership is keyed by tutor, student, source kind, fingerprint scheme, and
  fingerprint rather than recording, transcript, job, or output IDs. Attachment and recovery
  pointers commit together, while generic session recovery cannot mutate source ownership. Source
  confirmation uses the attached recording/transcript IDs, and lesson linking remains an ordinary
  recovery field. Successful replacement confirmation releases the old fingerprint;
  released-source reuse receives fresh recording/transcript lineage. Historical nonowners and
  unclassified historical sources remain readable but cannot perform new canonical mutations.
- An eligible uploaded recording remains replaceable after an unfinished assignment resumes.
  Passive rehydration suppresses session writes until an explicit edit, including opening Replace
  audio; completed or Share-reserved sessions remain ineligible.
- Confirmed Source exclusively drives transcript-hash-keyed lesson memory from its immutable URI.
  Prompt generation consumes confirmed Source/Context; Preview and Share consume confirmed Create.
- For a `tutor_only` profile, Source confirmation durably starts one automatic initial enrichment
  from its exact canonical ready lesson evidence. The student-memory worker reconciles the
  operation; ambiguous provider submissions remain `uncertain` without resubmission. The backend
  serves assignment-scoped learner context and checks the visible active revision on Context
  confirmation. Student Learning saves ordinary tutor edits as active revisions; candidate-derived
  draft review remains separate.
- Confirmed Source also makes retained recording audio unavailable in the same transaction and queues
  recording-owned deletion; historical confirmed rows are backfilled to that lifecycle without
  changing transcript, Source snapshot, or downstream text lineage.
- The frontend owns automatic debounce/retry/refresh mechanics and preserves local buffers on
  conflict. The frontend enables Share only when confirmed recovery and current artifacts are clean;
  before reservation it drains pending recovery and returns a dirty session to its earliest
  reconfirmation boundary. The backend owns confirmation prerequisites, lineage validation,
  invalidation, stable Share reservation/retry, and the canonical active/completed predicate.
- Routine tutor Save/Refresh responsibility is absent. Stable data refreshes only on load, focus, or
  mutation completion; async recording/job and pending initial profile enrichment work poll. Navigation guards only unrecovered or
  ambiguous work and drains pending recovery before leaving.

## Update Rules

- Update this file when a capability moves between planned, partial, and live or its ownership
  boundary changes.
- Put route/env/payload detail in generated indexes, package READMEs, references, or runbooks.
- Keep historical implementation narrative in plans or archive docs.

## Related

- [`packages/batch-frontend/README.md`](../../packages/batch-frontend/README.md)
- [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)
- [`packages/telegram-ops-bot/README.md`](../../packages/telegram-ops-bot/README.md)
- [`docs/PIPELINE_INTEGRATION_VISION.md`](../PIPELINE_INTEGRATION_VISION.md)

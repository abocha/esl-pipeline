# V1 Implementation Tracker (Execution Cards)

## Meta

- Audience: founder-maintainer and AI pair.
- Read Time: 12 minutes.
- Authority Level: V1 execution source of truth.
- Last Updated: 2026-02-11.
- Reconciled commit window: `91cfb55..HEAD`.

## Purpose

- Turn roadmap items into session-sized implementation steps.
- Keep shipped progress visible and traceable by commit hash.
- Preserve momentum when returning with low focus.

## Use This In 60 Seconds

1. Read `Current Sprint Focus`.
2. Execute only the `Now` slice for that workstream.
3. Run listed command(s).
4. Append one evidence line with a commit hash.
5. Stop after one micro-task if energy is low.

## Scope Lock (This Phase)

1. MVP ships one trusted preset content track only: `general-english`.
2. Current goal is preset plumbing and architecture, not broad preset catalog authoring.
3. Pedagogic preset authoring can proceed in parallel with tutors, but must not block core structure delivery.
4. Canonical baseline prompt in this phase: `docs/templates/hw_prompt_v4-2_clean.md`.
5. Prompt governance is immutable snapshots + stable alias.
6. Model strategy is one universal prompt core + runtime scaffolding.

## Current Sprint Focus

- Active workstream: `WS2A Preset plumbing MVP`.
- This week objective: finalize Preset V2 architecture contract and execution surfaces.
- Today `Now` task (30-90 min): complete `WS2A-S1` only.
- Success for today: baseline prompt + versioning + model strategy are locked and documented as canonical.

## Delivery Model (Locked)

- Capacity: `8-12` hours/week.
- Accountable owner: `Founder (Accountable Owner)`.
- Support: `AI Pair (Execution Support, non-accountable)`.

Rules:

1. Only one active workstream at a time.
2. If blocked for 20 minutes, shrink scope instead of switching workstreams.
3. If 2+ readiness metrics are red, next session is reliability-only.

## Workstream Order and Gates

| Workstream | Status | Start | End | Dependency Gate |
| --- | --- | --- | --- | --- |
| WS0 Delivered foundation lane | `complete` | historical | historical | none |
| WS1 CEFR baseline presets | `complete` | W1 (2026-02-09) | W3 (2026-03-01) | none |
| WS6 Readiness instrumentation (minimal first) | `complete` | W1 (2026-02-09) | W4 (2026-03-08) | WS1 metric hooks merged |
| WS2A Preset plumbing MVP | `active` | W4 (2026-03-02) | W7 (2026-03-29) | WS1 + WS6 complete |
| WS2B Direct LLM generation | `deferred` | W8 (2026-03-30) | W9 (2026-04-12) | WS2A complete |
| WS3 TTS abstraction + fallback | `parked` | W10 (2026-04-13) | W12 (2026-05-03) | WS2B seam pattern stable |
| WS5 Cost and quota policy | `parked` | W11 (2026-04-20) | W13 (2026-05-10) | WS2B + WS3 usage telemetry available |
| WS4 CRM-lite lesson ledger | `parked` | W13 (2026-05-04) | W15 (2026-05-24) | WS2A assignment flow stable |
| Stabilization and gate review | `queued` | W16 (2026-05-25) | W17 (2026-06-07) | WS2A-WS6 MVP complete |

---

## WS0 Delivered Foundation Lane (Already Shipped)

This lane tracks meaningful shipped capability that supports V1 but does not map 1:1 to WS1/WS2A/WS6 roadmap cards.

### WS0-A Publishing and Action Foundations

- Added `rerun_publish` action path and minimal UI support (`d9fcd9b`).
- Added `html` publish target and integrated publish flow changes (`2616f8d`).
- Why it matters: provides fallback publish pathways and stronger rerun ergonomics before WS2B/WS3 expansion.

### WS0-B Resume, Context, and Provenance Reliability

- Added resumable minimal workflow and transcription cache reuse (`70dbabb`).
- Synced minimal profile selection to selected student (`32a84aa`).
- Hardened resume profile/student context synchronization (`b55c721`, `0f09bf1`).
- Refreshed workspace lineage inspection and derived job-student context reliably (`fdabe4c`).
- Why it matters: reduces session reset friction and improves data continuity.

### WS0-C Pipeline and Adapter Resilience

- Retried transient Deepgram transport failures in backend (`c163b82`).
- Added retry and actionable unreachable errors in Anytype adapter (`6387fa7`).
- Improved markdown validator acceptance of spaced media directive URLs (`38d349c`).
- Why it matters: fewer transient failures and safer processing of real-world input.

### WS0-D Presentation/UX Polish (Non-Blocking)

- Updated Anytype published HTML visuals (dark mode/animation/scroll affordances) (`1156b73`).
- Why it matters: improves output quality without changing core roadmap dependencies.

---

## Execution Card Template (Reuse for Every WS)

- Objective:
- Now (30-90 min):
- Definition of Ready:
- File Map:
- Session Slices:
- Commands:
- Evidence line:
- Rollback toggle:

---

## WS1 Execution Card: CEFR Baseline Presets (Complete)

### Objective

Implement CEFR-aware preset metadata through existing job-options APIs and allow minimal frontend publish flow to send selected preset deterministically.

### Completion Summary

- WS1-S1 delivered in `725b2c7` (contracts + backend payload metadata).
- WS1-S2/S3/S4 delivered in `1e5178c` (tests + frontend wiring).
- WS1-S4 hardening delivered in `ced149b` (resume normalization + publish guard + regressions).

### WS1 Definition of Done

- [x] CEFR contract fields added as optional (no breaking changes).
- [x] `/config/job-options` emits CEFR metadata.
- [x] Minimal assignment UI allows preset selection.
- [x] Publish/materialize sends chosen preset via `jobOverrides.preset`.
- [x] Backend + frontend tests pass.

---

## WS6 Execution Card: Readiness Instrumentation (Complete)

### Objective

Expose source-grounded readiness metrics for weekly product review.

### Completion Summary

- WS6-S1 and WS6-S2 delivered in `6dc6459`:
  - readiness source map in metrics layer,
  - backend readiness aggregation plumbing,
  - `GET /metrics/readiness` route and integration coverage,
  - readiness contracts.
- Post-delivery correctness fix delivered in `944f6c8`:
  - corrected readiness aggregation query semantics,
  - expanded repository test coverage.

### WS6 Definition of Done

- [x] Source map exists for readiness metrics.
- [x] `GET /metrics/readiness` is implemented.
- [x] Endpoint covered by integration tests.
- [x] Aggregation query correctness fixed post-merge.

---

## WS2A Execution Card: Preset Plumbing MVP (Active)

### Objective

Implement Preset V2 core structure so one trusted `general-english` preset can ship now and additional tracks can be added later without rewrites.

### Canonical Spec

- `docs/reference/PRESET_V2_SPEC.md` is authoritative for Preset V2 semantics.

### Definition of Ready

- [x] WS1 complete.
- [x] WS6 complete.
- [x] MVP scope lock accepted: `general-english` content only.
- [ ] Preset V2 contract surfaces mapped to implementation files.
- [ ] Baseline prompt/versioning/model strategy decisions are explicitly documented.

### File Map (Primary)

- `docs/reference/PRESET_V2_SPEC.md`
- `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
- `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- `docs/templates/hw_prompt_v4-2_clean.md`
- `packages/contracts/src/index.ts`
- `packages/batch-backend/src/application/get-job-options.ts`
- `packages/batch-backend/src/transport/extended-routes.ts`
- `packages/batch-frontend/src/utils/api.ts`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- `packages/anytype-adapter/src/rendering.ts`

### Session Slices (Do In Order)

#### WS2A-S1 Terminology + Model Lock (30-90 min)

- Goal: lock Preset V2 definition (`preset = prompt + metadata + output schema contract`).
- Required WS2A-S1 decisions:
  - `Learning Preset` terminology is canonical.
  - baseline prompt is `docs/templates/hw_prompt_v4-2_clean.md`.
  - governance is immutable snapshots + stable alias.
  - strategy is universal prompt core + runtime scaffolding.
- Edit:
  - `docs/reference/PRESET_V2_SPEC.md`
  - `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
  - `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
  - `START_HERE.md`
  - `docs/playbooks/RESTART_TOMORROW.md`
- Command:
  - `rg -n "hw_prompt_v4-2_clean|immutable snapshots|stable alias|universal prompt|runtime scaffolding|WS2A|WS2B" docs/reference START_HERE.md docs/playbooks/RESTART_TOMORROW.md`
- Evidence line template:
  - `WS2A-S1 done: Learning Preset term, baseline prompt, versioning policy, and universal scaffolding strategy documented and routed.`

#### WS2A-S2 Preset Surface Mapping (30-90 min)

- Goal: document exactly where Preset V2 will be surfaced in contracts/backend/frontend.
- Edit:
  - `docs/reference/PRESET_V2_SPEC.md`
  - `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- Command:
  - `rg -n "presets|cefr|job-options|materialize" packages/contracts packages/batch-backend packages/batch-frontend`
- Evidence line template:
  - `WS2A-S2 done: implementation surface map locked with file-level references.`

#### WS2A-S3 Prompt Workspace MVP Contract (30-90 min)

- Goal: define prompt/preset management workflow for MVP (without full catalog build).
- Research note:
  - capture Schema-Guided Reasoning investigation path for weaker-model reliability (planning artifact only in this phase).
- Edit:
  - `docs/reference/PRESET_V2_SPEC.md`
  - `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- Command:
  - `rg -n "Prompt Workspace|output schema|version" docs/reference`
- Evidence line template:
  - `WS2A-S3 done: Prompt Workspace MVP lifecycle and versioning contract documented.`

#### WS2A-S4 Preview Contract (30-90 min)

- Goal: lock requirement that draft preview uses internal HTML renderer path before publish.
- Edit:
  - `docs/reference/PRESET_V2_SPEC.md`
  - `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- Command:
  - `rg -n "preview|html|render" docs/reference packages/anytype-adapter`
- Evidence line template:
  - `WS2A-S4 done: preview contract locked to internal HTML renderer path.`

#### WS2A-S5 MVP Exit Check (30-60 min)

- Goal: confirm docs are decision-complete enough for implementation without re-planning.
- Edit:
  - `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- Command:
  - `rg -n "WS2A|general-english|deferred|WS2B" docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- Evidence line template:
  - `WS2A complete: preset plumbing MVP scope and implementation contracts are decision-complete.`

### WS2A Done Criteria

- [ ] Preset V2 model is canonical and routed.
- [ ] Baseline prompt is explicitly locked to `docs/templates/hw_prompt_v4-2_clean.md`.
- [ ] Immutable snapshot + alias policy is documented.
- [ ] Prompt Workspace MVP contract is documented.
- [ ] Preview requirement is documented and tied to HTML renderer path.
- [ ] General English-only scope lock is explicit across docs.
- [ ] WS2B defer gate is explicit and enforced in tracker.

---

## WS2B Execution Card: Direct LLM Generation (Deferred)

### Objective

Remove manual copy-paste dependency with backend generation endpoint + frontend entrypoint.

### Status

- `deferred` until WS2A is complete.

### Start Gate (Mandatory)

- [ ] WS2A done criteria all checked.
- [ ] Preset V2 surfaces stabilized.
- [ ] Chosen low-cost model/provider path documented.

### Future Session Slices (After Gate Opens)

#### WS2B-S1 Contracts Finalization

- Add:
  - `GenerateDraftRequest`
  - `GenerateDraftResponse`
- Edit:
  - `packages/contracts/src/index.ts`

#### WS2B-S2 Backend Endpoint Skeleton + Error Contract Test

- Endpoint target:
  - `POST /generation/drafts`
- Edit:
  - `packages/batch-backend/src/transport/extended-routes.ts`
  - `packages/batch-backend/tests/transport.http-server.integration.test.ts`

#### WS2B-S3 Frontend Trigger Wiring

- Edit:
  - `packages/batch-frontend/src/utils/api.ts`
  - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`

### WS2B Done Criteria

- [ ] Contracts merged for generation request/response.
- [ ] Backend endpoint functional and tested.
- [ ] Minimal UI wired with fallback behavior retained.
- [ ] Error states are visible and actionable.

---

## Parked Workstreams (Do Not Start Yet)

### WS3 TTS Abstraction + Fallback

Start only when:

- [ ] WS2B request/response shape is stable.
- [ ] Provider seam can be reused from generation service patterns.

### WS5 Cost and Quota Policy

Start only when:

- [ ] WS2B and WS3 produce stable usage telemetry.

### WS4 CRM-Lite Lesson Ledger

Start only when:

- [ ] WS2A assignment flow is stable and no longer changing core preset model shape.

---

## Blocker Protocol (Mandatory)

If blocked for >20 minutes:

1. Write blocker in one sentence.
2. Shrink to a smaller slice in the same workstream.
3. If still blocked, add a concrete question in tracker and stop cleanly.

Do not jump to another workstream in the same session.

## Evidence Log (Append Weekly)

- YYYY-MM-DD | WSx-Sy | what changed | command(s) run | result | link/reference

Recent evidence:

- 2026-02-10 | WS1-S1 | added optional CEFR fields to contracts and job-options payload | `pnpm --filter @esl-pipeline/contracts typecheck`; `pnpm --filter @esl-pipeline/batch-backend typecheck` | pass | commit `725b2c7`
- 2026-02-10 | WS1-S2/S3/S4 | completed CEFR flow wiring across backend/frontend + tests | `pnpm --filter @esl-pipeline/batch-backend test`; `pnpm --filter @esl-pipeline/batch-frontend test` | pass | commit `1e5178c`
- 2026-02-10 | WS1-S4 hardening | normalized resume preset selection and added publish guard + regressions | `pnpm --filter @esl-pipeline/batch-frontend test` | pass | commit `ced149b`
- 2026-02-10 | WS6-S1/S2 | added readiness source map + endpoint + integration/app tests | `pnpm --filter @esl-pipeline/batch-backend test` | pass | commit `6dc6459`
- 2026-02-10 | WS6 correctness fix | corrected readiness aggregation query and expanded repository tests | `pnpm --filter @esl-pipeline/batch-backend test` | pass | commit `944f6c8`
- 2026-02-10 | WS0-A | shipped rerun publish action in backend + minimal UI | n/a | merged | commit `d9fcd9b`
- 2026-02-10 | WS0-A | added html publish target and publish/resume plumbing | n/a | merged | commit `2616f8d`
- 2026-02-10 | WS0-B | added resumable minimal workflow and cache reuse | n/a | merged | commit `70dbabb`
- 2026-02-10 | WS0-B | synced profile selection to student and resume context reliability | n/a | merged | commits `32a84aa`, `b55c721`, `0f09bf1`
- 2026-02-10 | WS0-B | refreshed workspace lineage and derived job student context | n/a | merged | commit `fdabe4c`
- 2026-02-10 | WS0-C | retried transient Deepgram failures | n/a | merged | commit `c163b82`
- 2026-02-10 | WS0-C | added Anytype unreachable retry with actionable errors | n/a | merged | commit `6387fa7`
- 2026-02-10 | WS0-C | md-validator accepts spaced media directive URLs | n/a | merged | commit `38d349c`
- 2026-02-10 | WS0-D | improved Anytype published HTML visuals | n/a | merged | commit `1156b73`

## Weekly Closeout Checklist

- [ ] One reliability improvement shipped.
- [ ] One usability improvement shipped.
- [ ] One value improvement shipped.
- [ ] Tracker updated with evidence line(s).
- [ ] If non-roadmap capability shipped, append it to WS0 with commit hash.
- [ ] `general-english` scope lock still holds for current phase.
- [ ] Baseline prompt lock still points to `docs/templates/hw_prompt_v4-2_clean.md`.
- [ ] `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md` completed.

## Related

- `docs/reference/PRESET_V2_SPEC.md`
- `START_HERE.md`
- `docs/playbooks/RESTART_TOMORROW.md`
- `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`
- `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
- `docs/backend-frontend/backend-frontend-alignment.md`

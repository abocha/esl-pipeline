# V1 Implementation Tracker (Execution Cards)

## Meta

- Audience: founder-maintainer and AI pair.
- Read Time: 10 minutes.
- Authority Level: V1 execution source of truth.
- Last Updated: 2026-02-10.

## Purpose

- Turn roadmap items into session-sized implementation steps.
- Remove ambiguity about where to code and what to run.
- Preserve momentum when returning with low focus.

## Use This In 60 Seconds

1. Read `Current Sprint Focus`.
2. Execute the `Now` task for that workstream only.
3. Run the listed command(s).
4. Paste one evidence line in this tracker.
5. Stop after one micro-task if energy is low.

## Current Sprint Focus

- Active workstream: `WS1 CEFR baseline presets`
- This week objective: wire CEFR-aware options through existing `/config/job-options` path and use selected preset in minimal assignment publish flow.
- Today `Now` task (30-90 min): complete `WS1-S5` validation and evidence updates.
- Success for today: WS1 checklist closed with `pnpm check:fast` green.

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
| WS1 CEFR baseline presets | `active` | W1 (2026-02-09) | W3 (2026-03-01) | none |
| WS6 Readiness instrumentation (minimal first) | `queued` | W1 (2026-02-09) | W4 (2026-03-08) | WS1 metric hooks merged |
| WS2 Direct LLM generation | `queued` | W4 (2026-03-02) | W6 (2026-03-22) | WS1 complete |
| WS3 TTS abstraction + fallback | `parked` | W7 (2026-03-23) | W9 (2026-04-12) | WS2 seam pattern stable |
| WS5 Cost and quota policy | `parked` | W8 (2026-03-30) | W10 (2026-04-19) | WS2 + WS3 usage telemetry available |
| WS4 CRM-lite lesson ledger | `parked` | W10 (2026-04-13) | W13 (2026-05-10) | WS1 assignment flow stable |
| Stabilization and gate review | `queued` | W14 (2026-05-11) | W15 (2026-05-24) | WS1-WS6 MVP complete |

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

## WS1 Execution Card: CEFR Baseline Presets

### Objective

Implement CEFR-aware preset metadata through existing job-options APIs and allow minimal frontend publish flow to send selected preset deterministically.

### Architectural Decision (Locked)

- Reuse existing `GET /config/job-options` endpoint.
- Extend `JobOptionsPayload` with optional CEFR fields (backward compatible):
  - `cefrLevels?: ('A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2')[]`
  - `cefrDefault?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'`

### Definition of Ready

- [ ] You can run package tests locally.
- [ ] No parallel workstream is in progress.
- [ ] `/config/job-options` path is confirmed as source for frontend options.

### File Map

- `packages/contracts/src/index.ts`
- `packages/batch-backend/src/application/get-job-options.ts`
- `packages/batch-backend/tests/application.get-job-options.test.ts`
- `packages/batch-backend/tests/transport.http-server.integration.test.ts`
- `packages/batch-frontend/src/utils/api.ts`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.test.tsx`

### Session Slices (Do In Order)

#### WS1-S1 Contracts + Backend Payload (30-90 min)

- Goal: add optional CEFR fields and return them from `getJobOptions` fallback/orchestrator path.
- Edit:
  - `packages/contracts/src/index.ts`
  - `packages/batch-backend/src/application/get-job-options.ts`
- Command:
  - `pnpm --filter @esl-pipeline/contracts typecheck`
  - `pnpm --filter @esl-pipeline/batch-backend typecheck`
- Evidence line template:
  - `WS1-S1 done: CEFR fields added to contracts + job-options payload. Commands: <cmd list>.`

#### WS1-S2 Backend Contract Tests (30-90 min)

- Goal: prove `/config/job-options` response includes CEFR fields and remains backward compatible.
- Edit:
  - `packages/batch-backend/tests/application.get-job-options.test.ts`
  - `packages/batch-backend/tests/transport.http-server.integration.test.ts`
- Command:
  - `pnpm --filter @esl-pipeline/batch-backend test`
- Evidence line template:
  - `WS1-S2 done: backend tests updated for CEFR options response.`

#### WS1-S3 Frontend API Surface (30-90 min)

- Goal: frontend typed response includes optional CEFR fields.
- Edit:
  - `packages/batch-frontend/src/utils/api.ts`
- Command:
  - `pnpm --filter @esl-pipeline/batch-frontend typecheck`
- Evidence line template:
  - `WS1-S3 done: frontend API types accept CEFR metadata.`

#### WS1-S4 Minimal UI Preset Selection (30-90 min)

- Goal: add preset selection in minimal assignment flow and send `preset` in `materializeDraft(...jobOverrides)`.
- Edit:
  - `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Command:
  - `pnpm --filter @esl-pipeline/batch-frontend test`
- Evidence line template:
  - `WS1-S4 done: preset selector wired to publish/materialize path.`

#### WS1-S5 Final Validation + Docs Evidence (30-60 min)

- Goal: validate end-to-end behavior and close WS1 checklist.
- Edit:
  - `docs/reference/V1_IMPLEMENTATION_TRACKER.md` (status + evidence)
  - package README notes only if behavior contract changed.
- Command:
  - `pnpm check:fast`
- Evidence line template:
  - `WS1 complete: CEFR options + minimal UI preset flow verified.`

### WS1 Definition of Done

- [x] CEFR contract fields added as optional (no breaking changes).
- [x] `/config/job-options` emits CEFR metadata.
- [x] Minimal assignment UI allows preset selection.
- [x] Publish/materialize sends chosen preset via `jobOverrides.preset`.
- [x] Backend + frontend tests pass.

### Rollback Toggle

- If UI breaks publish flow, temporarily disable preset selector display and fall back to default preset while preserving backend CEFR fields.

---

## WS6 Execution Card: Readiness Instrumentation (First 2 Slices Only)

### Objective

Expose minimal readiness metrics source so weekly review is evidence-based.

### Definition of Ready

- [ ] WS1 merged.
- [ ] At least one reliable source for assignment success and publish latency is identified.

### WS6-S1 Metrics Shape and Source Map (30-90 min)

- Edit:
  - `packages/contracts/src/index.ts` (only if cross-boundary DTO needed)
  - `packages/batch-backend/src/infrastructure/metrics.ts`
  - `packages/batch-backend/src/application/*` sources that already emit relevant events
- Output:
  - explicit mapping table: metric -> source -> calculation window.

### WS6-S2 Minimal Endpoint + Test (30-90 min)

- Edit:
  - `packages/batch-backend/src/transport/extended-routes.ts`
  - `packages/batch-backend/tests/transport.http-server.integration.test.ts`
- Endpoint target:
  - `GET /metrics/readiness` (minimal payload: publish success, median publish latency, first-session success proxy)
- Command:
  - `pnpm --filter @esl-pipeline/batch-backend test`

---

## WS2 Execution Card: Direct LLM Generation (First 2 Slices Only)

### Objective

Remove manual copy/paste dependency with backend generation endpoint + frontend entrypoint.

### Definition of Ready

- [x] WS1 complete.
- [ ] Chosen low-cost model/provider path documented.

### WS2-S1 Contracts Finalization (30-90 min)

- Edit:
  - `packages/contracts/src/index.ts`
- Add:
  - `GenerateDraftRequest`
  - `GenerateDraftResponse`
- Command:
  - `pnpm --filter @esl-pipeline/contracts typecheck`

### WS2-S2 Backend Endpoint Skeleton + Error Contract Test (30-90 min)

- Edit:
  - `packages/batch-backend/src/transport/extended-routes.ts`
  - `packages/batch-backend/tests/transport.http-server.integration.test.ts`
- Endpoint target:
  - `POST /generation/drafts`
- Command:
  - `pnpm --filter @esl-pipeline/batch-backend test`

---

## Parked Workstreams (Do Not Start Yet)

### WS3 TTS Abstraction + Fallback

Start only when:

- [ ] WS2 request/response shape is stable.
- [ ] provider seam can be reused from generation service patterns.

### WS5 Cost and Quota Policy

Start only when:

- [ ] WS2 and WS3 produce stable usage telemetry.

### WS4 CRM-Lite Lesson Ledger

Start only when:

- [ ] WS1 assignment flow is stable and no longer changing core payload shape.

---

## Blocker Protocol (Mandatory)

If blocked for >20 minutes:

1. Write blocker in one sentence.
2. Shrink to a smaller slice in same workstream.
3. If still blocked, add a concrete question in tracker and stop cleanly.

Do not jump to another workstream in the same session.

## Evidence Log (Append Weekly)

- YYYY-MM-DD | WSx-Sy | what changed | command(s) run | result | link/reference

Recent evidence:

- 2026-02-10 | WS1-S1 | added optional CEFR fields to contracts and job-options payload | `pnpm --filter @esl-pipeline/contracts typecheck`; `pnpm --filter @esl-pipeline/batch-backend typecheck` | pass | commit `725b2c7`
- 2026-02-10 | WS1-S2 | backend tests now assert CEFR metadata in job-options app + HTTP paths | `pnpm --filter @esl-pipeline/batch-backend test` | pass | local branch
- 2026-02-10 | WS1-S3 | frontend job-options API surface now types optional CEFR metadata | `pnpm --filter @esl-pipeline/batch-frontend typecheck` | pass | local branch
- 2026-02-10 | WS1-S4 | minimal assignment publish flow wired with preset selector and `jobOverrides.preset` | `pnpm --filter @esl-pipeline/batch-frontend test` | pass | local branch
- 2026-02-10 | WS1-S5 | end-to-end validation for WS1 completed and tracker updated | `pnpm check:fast` | pass | local branch

## Weekly Closeout Checklist

- [ ] One reliability improvement shipped.
- [ ] One usability improvement shipped.
- [ ] One value improvement shipped.
- [ ] Tracker updated with evidence line(s).
- [ ] `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md` completed.

## Related

- `START_HERE.md`
- `docs/playbooks/RESTART_TOMORROW.md`
- `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`
- `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
- `docs/backend-frontend/backend-frontend-alignment.md`

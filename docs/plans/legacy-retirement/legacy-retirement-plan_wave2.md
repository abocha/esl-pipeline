## Wave 2 Implementation Plan (Legacy Retirement, Mixed Labels: Minor + Patch)

### Summary

Complete Wave 2 retirement items from the canonical backlog with a deterministic execution order, one PR per item, and strict migration-note + docs alignment for public-contract reductions plus DB-canonical runtime fallback retirements carried over after Wave 1 closure.

Wave 2 items:

- LR-014
- LR-015
- LR-005
- LR-003
- LR-011
- LR-013
- LR-002
- LR-012

### Scope

1. In scope:

- Public-contract dual-path reductions listed in Wave 2 of [legacy-retirement-backlog.md](/home/abocha/code/esl-pipeline/docs/plans/legacy-retirement/legacy-retirement-backlog.md).
- Runtime DB-canonical hardening items in Wave 2 that remove remaining filesystem fallback/probe behavior in runtime paths (`LR-014`, `LR-015`).
- Runtime/code/docs/test updates per inventory `docs_to_update`.
- Inventory status transitions (`queued` -> `in_progress` -> `done`).

2. Out of scope:

- Wave 3 breaking removals (`LR-001`, `LR-004`).
- New product features not tied to legacy retirement surfaces.

### PR/Branch Strategy

1. Use one branch per item from `main`:

- `codex/lr-014-remove-student-runtime-fs-probe`
- `codex/lr-015-remove-worker-manifest-fs-fallback`
- `codex/lr-005-remove-gen-budget-alias`
- `codex/lr-003-remove-job-approved-alias`
- `codex/lr-011-remove-validator-legacy-payload`
- `codex/lr-013-remove-elevenlabs-voice-id-legacy`
- `codex/lr-002-remove-legacy-preset-acceptance`
- `codex/lr-012-remove-pmd-legacy-fenced-path`

2. Use one PR per item.
3. Every PR label must match the item-required label in the backlog:

- `release:patch` for `LR-014`, `LR-015`
- `release:minor` for `LR-005`, `LR-003`, `LR-011`, `LR-013`, `LR-002`, `LR-012`

4. Each PR must include the playbook acceptance sections from [legacy-retirement-execution-playbook.md](/home/abocha/code/esl-pipeline/docs/plans/legacy-retirement/legacy-retirement-execution-playbook.md).

### Deterministic Sequence (Rubric-Based)

| Order | Item   | public_contract_risk | runtime_complexity | blast_radius | migration_readiness | Why now                                                                |
| ----- | ------ | -------------------- | ------------------ | ------------ | ------------------- | ---------------------------------------------------------------------- |
| 1     | LR-014 | 0                    | 1                  | 0            | 2                   | Internal runtime probe cleanup with migration boundary already defined |
| 2     | LR-015 | 0                    | 2                  | 1            | 1                   | Internal runtime fallback removal before additional public reductions  |
| 3     | LR-005 | 1                    | 0                  | 0            | 2                   | Smallest public env surface; fastest de-risked start in public subset  |
| 4     | LR-003 | 1                    | 1                  | 1            | 1                   | Single-package API alias cleanup with bounded impact                   |
| 5     | LR-011 | 1                    | 2                  | 1            | 2                   | Validator contract cleanup before broader submit-path cleanup          |
| 6     | LR-013 | 1                    | 2                  | 1            | 2                   | Isolated provider contract cleanup                                     |
| 7     | LR-002 | 1                    | 2                  | 2            | 2                   | Higher-traffic submit path; do after smaller public reductions         |
| 8     | LR-012 | 1                    | 2                  | 2            | 2                   | Broad parser/input compatibility removal; execute last in Wave 2       |

### Item-by-Item Execution Plan

### LR-014 (Student runtime legacy filesystem probe)

1. Implementation:

- Remove runtime filesystem `studentsDir` probe/warn path from [student-profiles-store.ts](/home/abocha/code/esl-pipeline/packages/batch-backend/src/application/student-profiles-store.ts).
- Keep student APIs strictly DB-backed and preserve DB-required behavior for `PG_ENABLED=false`.
- Keep migration tooling filesystem reads in [backfill-student-system.ts](/home/abocha/code/esl-pipeline/packages/batch-backend/src/tools/backfill-student-system.ts) unchanged.

2. Tests:

- `pnpm --filter @esl-pipeline/batch-backend test -- application.student-profiles-store.test.ts`
- Add/update tests to assert no runtime dependency on `studentsDir` filesystem probing.

3. Docs:

- [STUDENT_SYSTEM_PHASE_A_RUNBOOK.md](/home/abocha/code/esl-pipeline/docs/reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md)
- [STUDENT_SYSTEM_ROADMAP.md](/home/abocha/code/esl-pipeline/docs/reference/STUDENT_SYSTEM_ROADMAP.md)
- [agents-ssot.md](/home/abocha/code/esl-pipeline/docs/reference/agents-ssot.md)

4. Exit criteria:

- Student runtime paths no longer read legacy student filesystem JSON for warning/probing.
- Migration/backfill tooling remains the only filesystem reader for student legacy JSON.

---

### LR-015 (Worker manifest filesystem fallback)

1. Implementation:

- Remove worker retry path that downgrades to `manifestStore: 'filesystem'` in [pipeline-worker-entry.ts](/home/abocha/code/esl-pipeline/packages/batch-backend/src/infrastructure/pipeline-worker-entry.ts).
- Fail fast with explicit storage/configuration error behavior when manifest S3 bucket is missing.
- Keep manifest storage behavior explicit and deterministic per configured provider.

2. Tests:

- `pnpm --filter @esl-pipeline/batch-backend test -- infrastructure.orchestrator-service.test.ts`
- `pnpm --filter @esl-pipeline/batch-backend test -- transport.worker-runner.integration.test.ts`
- Add/update tests to assert no runtime filesystem manifest fallback under S3 misconfiguration.

3. Docs:

- [env.md](/home/abocha/code/esl-pipeline/docs/reference/env.md)
- [batch-backend-ssot.md](/home/abocha/code/esl-pipeline/docs/backend-frontend/batch-backend-ssot.md)
- [agents-ssot.md](/home/abocha/code/esl-pipeline/docs/reference/agents-ssot.md)

4. Exit criteria:

- Worker runtime no longer downgrades manifest store to filesystem.
- Operational docs describe explicit fail-fast behavior for missing manifest bucket/config.

---

### LR-005 (Env alias: `GEN_BUDGET_EMERGENCY_OVERRIDE`)

1. Implementation:

- Remove alias fallback from [env.ts](/home/abocha/code/esl-pipeline/packages/batch-backend/src/config/env.ts).
- Keep canonical `GEN_ALLOW_PAID_SPEND` only.
- Ensure startup/config behavior remains explicit and deterministic.

2. Tests:

- `pnpm --filter @esl-pipeline/batch-backend test -- config.env.test.ts`
- Add/update assertions to reject or ignore deprecated alias per decided contract.

3. Docs:

- [env.md](/home/abocha/code/esl-pipeline/docs/reference/env.md)
- [GENERATION_PROVIDER_POLICY.md](/home/abocha/code/esl-pipeline/docs/reference/GENERATION_PROVIDER_POLICY.md)
- `.env.example`

4. Exit criteria:

- No runtime parsing path reads `GEN_BUDGET_EMERGENCY_OVERRIDE`.
- Docs no longer present alias as supported runtime contract.

---

### LR-003 (Timeline alias: `job_approved`)

1. Implementation:

- Remove alias mapping in [student-timeline.ts](/home/abocha/code/esl-pipeline/packages/batch-backend/src/application/student-timeline.ts) that maps `job_approved` -> `job_awaiting_approval`.
- Keep canonical filter values only.

2. Tests:

- `pnpm --filter @esl-pipeline/batch-backend test -- application.student-timeline.test.ts`
- Add/update tests to validate canonical filter behavior and legacy alias handling contract.

3. Docs:

- [batch-backend-ssot.md](/home/abocha/code/esl-pipeline/docs/backend-frontend/batch-backend-ssot.md)
- [agents-ssot.md](/home/abocha/code/esl-pipeline/docs/reference/agents-ssot.md)

4. Exit criteria:

- API behavior and docs are aligned on canonical timeline status filters.

---

### LR-011 (md-validator legacy payload/preset mapping)

1. Implementation:

- Remove validator legacy payload compatibility assembly in [validator.ts](/home/abocha/code/esl-pipeline/packages/md-validator/src/validator.ts).
- Remove legacy preset mapping path in [registry.ts](/home/abocha/code/esl-pipeline/packages/md-validator/src/rulesets/registry.ts) where `preset` maps to `general-english`.
- Keep canonical issue metadata and `learningPresetId` behavior only.

2. Tests:

- `pnpm --filter @esl-pipeline/md-validator test`
- Add/update tests currently asserting legacy payload keys and legacy preset mapping.

3. Docs:

- [MD_VALIDATOR_RULESET_CONVENTIONS.md](/home/abocha/code/esl-pipeline/docs/reference/MD_VALIDATOR_RULESET_CONVENTIONS.md)
- [agents-ssot.md](/home/abocha/code/esl-pipeline/docs/reference/agents-ssot.md)

4. Exit criteria:

- Validator contract docs and output behavior match canonical-only shape.

---

### LR-013 (ElevenLabs legacy `voice_id` field)

1. Implementation:

- Remove `voice_id` compatibility from dialogue input normalization in [dialogue.ts](/home/abocha/code/esl-pipeline/packages/tts-provider-elevenlabs/src/dialogue.ts).
- Remove deprecated `voice_id` typing paths in [types.ts](/home/abocha/code/esl-pipeline/packages/tts-provider-elevenlabs/src/types.ts) for internal dialogue contract where applicable.
- Keep external provider-response parsing compatibility only where required by provider API payloads, not local input contract aliases.

2. Tests:

- `pnpm --filter @esl-pipeline/tts-provider-elevenlabs test`
- Update tests that currently assert `voice_id` request compatibility.

3. Docs:

- [README.md](/home/abocha/code/esl-pipeline/packages/tts-provider-elevenlabs/README.md)
- [agents-ssot.md](/home/abocha/code/esl-pipeline/docs/reference/agents-ssot.md)

4. Exit criteria:

- Dialogue input contract is camelCase-only (`voiceId`).

---

### LR-002 (Legacy `preset` acceptance path)

1. Implementation:

- Remove legacy `preset` acceptance/normalization from batch submit/materialize routes and application handlers:
  - [core-routes.ts](/home/abocha/code/esl-pipeline/packages/batch-backend/src/transport/core-routes.ts)
  - [extended-routes.ts](/home/abocha/code/esl-pipeline/packages/batch-backend/src/transport/extended-routes.ts)
  - [submit-job.ts](/home/abocha/code/esl-pipeline/packages/batch-backend/src/application/submit-job.ts)
  - [create-approval-job.ts](/home/abocha/code/esl-pipeline/packages/batch-backend/src/application/create-approval-job.ts)
  - [learning-preset.ts](/home/abocha/code/esl-pipeline/packages/batch-backend/src/application/learning-preset.ts)
- Remove `preset` from public contracts where this item requires canonicalization:
  - [index.ts](/home/abocha/code/esl-pipeline/packages/contracts/src/index.ts)
- Align frontend API payload generation to canonical-only `learningPresetId`:
  - [api.ts](/home/abocha/code/esl-pipeline/packages/batch-frontend/src/utils/api.ts)
  - [MinimalAssignment.tsx](/home/abocha/code/esl-pipeline/packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx)

2. Tests:

- `pnpm --filter @esl-pipeline/contracts typecheck && pnpm --filter @esl-pipeline/batch-backend test -- application.submit-job.test.ts`
- Add targeted frontend tests for publish/validation payloads using `learningPresetId` only.

3. Docs:

- [agents-ssot.md](/home/abocha/code/esl-pipeline/docs/reference/agents-ssot.md)
- [PRESET_V2_SPEC.md](/home/abocha/code/esl-pipeline/docs/reference/PRESET_V2_SPEC.md)
- [README.md](/home/abocha/code/esl-pipeline/packages/batch-backend/README.md)

4. Exit criteria:

- Submit/materialize external contract is canonical-only (`learningPresetId`).
- No backend/public schema accepts legacy `preset` for this path.

---

### LR-012 (PMD legacy-fenced parser path)

1. Implementation:

- Remove legacy fenced source format path in:
  - [source.ts](/home/abocha/code/esl-pipeline/packages/pmd/src/source.ts)
  - [parser.ts](/home/abocha/code/esl-pipeline/packages/pmd/src/parser.ts)
- Enforce frontmatter-at-byte-0 canonical input contract only.
- Update md-validator fixtures/tests that rely on legacy fenced fixtures.

2. Tests:

- `pnpm --filter @esl-pipeline/pmd test && pnpm --filter @esl-pipeline/md-validator test`
- Add/update parser tests to assert hard failure for legacy fenced-only documents.

3. Docs:

- [agents-ssot.md](/home/abocha/code/esl-pipeline/docs/reference/agents-ssot.md)
- [MD_VALIDATOR_RULESET_CONVENTIONS.md](/home/abocha/code/esl-pipeline/docs/reference/MD_VALIDATOR_RULESET_CONVENTIONS.md)

4. Exit criteria:

- PMD/validator runtime accepts only canonical frontmatter-first markdown.

### Validation Gates Per Item PR

1. Required item-specific commands from inventory must pass.
2. `pnpm check:fast` must pass.
3. `pnpm docs:check` must pass for item PRs that change docs/contracts.
4. PR must carry exactly one label and it must match the item-required release label from backlog (`release:patch` for `LR-014`/`LR-015`, otherwise `release:minor` for Wave 2 public items).
5. Inventory item status is updated to `in_progress` at PR start and `done` only after merge.

### Wave 2 Completion Definition

1. All Wave 2 items (`LR-014`, `LR-015`, `LR-005`, `LR-003`, `LR-011`, `LR-013`, `LR-002`, `LR-012`) are `done` in [legacy-retirement-inventory.md](/home/abocha/code/esl-pipeline/docs/plans/legacy-retirement/legacy-retirement-inventory.md).
2. All item PRs merged with exactly one required label per item (`release:patch` or `release:minor`).
3. SSOT/docs reflect canonical contracts only for these surfaces.
4. No runtime code paths remain for these Wave 2 compatibility aliases.

### Assumptions

1. Wave 2 proceeds as eight item-scoped PRs for safer review/rollback on mixed public-contract and runtime-hardening changes.
2. If implementation reveals a truly breaking external behavior, that item pauses and is reclassified before merge.
3. Wave 3 remains reserved for explicitly breaking removals (`LR-001`, `LR-004`).

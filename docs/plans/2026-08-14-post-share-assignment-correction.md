# Post-Share Assignment Correction Implementation Plan

## Meta

- Audience: primary implementation agent, delegated implementers, and reviewers.
- Authority Level: approved active implementation plan.
- Last Verified Against: 2026-08-14 repository state and production incident diagnosis for job
  `da4fe0e5-bcf4-4bf0-896d-a3df8c5c6eae`.
- Owner: batch frontend, batch backend, contracts, and orchestrator maintainers.
- Review Cadence: after each delegated ownership boundary and before final handoff.
- Status: `active`.
- Current Focus: implementation is committed to the feature branch; local implementation,
  validation, and review are complete, and the next boundary is PR creation and hosted CI.
- Exit Trigger: archive after the implementation PR merges and durable behavior is represented in
  current package/reference documentation.

## Approved invariant

A shared assignment session remains immutable. A tutor explicitly enters correction mode, durably
saves the current mutable draft, and publishes a child job bound to that exact version and hash. The
child uses normal assignment pipeline semantics and child-owned output/manifest identity. The parent
job, its output, and the completed session remain unchanged.

## Constraints

- Do not reinterpret `republishOnly` or inherit source generated artifacts for a correction.
- Do not introduce assignment-session revisions, a database migration, generic idempotency
  machinery, or a homework-memory policy change.
- Use the existing job Markdown storage field, `source_job_id`, configuration fields, and normal
  content-addressed caches.
- Use a stable request/job identity, authoritative draft row lock and version/hash comparison, and
  durable child insertion before queue reconciliation.
- Preserve unrelated work and perform no branch, commit, push, PR, deployment, or production
  mutation.

## Execution plan

### 1. Backend, contracts, and worker

- [x] Add focused failing tests for correction authorization/provenance, snapshot CAS, idempotency,
      parent/session immutability, configuration inheritance, and operation-order races.
- [x] Add a distinct correction request/response contract and authenticated command route.
- [x] Implement the transaction that locks and snapshots the authoritative draft into one child job.
- [x] Add an explicit correction execution discriminator that invokes normal assignment execution
      from the child's fixed Markdown object and child-owned manifest identity.
- [x] Prove historical `republishOnly`, source manifests, and source audio remain unchanged.
- [x] Run focused contract/backend/queue/worker tests.

### 2. Primary integration audit

- [x] Inspect the backend diff and verify the approved persistence, concurrency, idempotency,
      lineage, and pipeline contracts before fixing the frontend API contract.

### 3. Completed-session and correction UI

- [x] Add focused failing tests for reference-only completed sessions, explicit correction entry,
      durable autosave drain, exact version/hash submission, stable request retry, and useful errors.
- [x] Implement correction mode and publish-correction API integration without reopening session
      confirmation.
- [x] Rename historical republish wording to **Republish published version**.
- [x] Run focused frontend tests.

### 4. Documentation, integrated validation, and review

- [x] Update current frontend/backend and pipeline behavior documentation.
- [x] Run integrated focused contract, backend, queue/worker, orchestrator, and frontend tests and
      inspect artifacts; use a narrow service-backed local diagnostic only when concretely needed.
- [x] Confirm successful hosted PR CI and the final `CI gate` for the target commit; report selected
      PostgreSQL/Redis evidence as CI-owned where local services are not needed.
- [x] Obtain narrow Sol review for concurrency/idempotency/snapshot/lineage risk.
- [x] Obtain final Terra review for cross-boundary integration, state-machine consistency, tests,
      historical rerun preservation, and complexity.
- [x] Resolve findings with focused tests and reroute material fixes to the originating reviewer.
- [x] Audit every approved acceptance criterion and leave the uncommitted tree ready for maintainer
      inspection.

## Validation evidence target

- Focused contract, backend transaction, queue/worker, orchestrator, and frontend Vitest lanes.
- Focused relevant local/package tests and checks for the changed behavior.
- Successful hosted PR CI and the final `CI gate` are the comprehensive merge requirement; use a
  narrow service-backed local diagnostic only when concretely needed for worker/integration behavior.
- Selected PostgreSQL/Redis evidence may remain CI-owned; never manufacture local service state.

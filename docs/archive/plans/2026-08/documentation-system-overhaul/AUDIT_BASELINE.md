# Documentation Audit Baseline

This file preserves the maintainer-provided audit baseline that motivated the overhaul.

Treat it as evidence, not as a mechanically binding implementation checklist. Verify source-sensitive and destructive actions against current repository state.

## Executive assessment

A substantial overhaul is warranted. The core model is good—layered routing, explicit SSOTs, a real archive, generated indexes, and automated doc checks—but the corpus has drifted at its boundaries:

- Some “current” references are materially wrong.
- Active-looking execution history exists outside the governed plan/archive lifecycle.
- Several routers and agent-workflow docs repeat the same material.
- Runtime prompt assets and drafts lack enough lifecycle/navigation context.
- The documentation gate validates structure and freshness metadata, but not semantic accuracy.

The audit found 348 tracked Markdown/text candidates and 7 tracked office/image support artifacts. Four Markdown files were test/example fixtures rather than documentation; the audit classification covered the remaining 351 documentation artifacts/supporting assets. `pnpm --silent docs:check` passed, confirming curated structural checks rather than semantic correctness.

## Confirmed highest-priority findings

### Incorrect migration head in versioning policy

- Affected: `docs/reference/VERSIONING_MODEL.md`
- Audit evidence: it names `0043_manual_transcript_source` while the live contract registry names a later migration head.
- Risk: incorrect migration/version validation.
- Preferred direction: remove the copied volatile head when possible and route to the registry.

### Orchestrator architecture docs omit live contract stages

- Affected:
  - `docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`
  - `docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`
  - routers that send refactor work there
- Audit evidence: the documents present a canonical stage sequence that omits current `voice-plan` and `speech-plan` stages.
- Risk: incorrect stage-contract/refactor work.
- Preferred direction: source-verify the current architecture and decide whether the pair remains distinct or should consolidate.

### Telegram runbook recommends a forbidden privileged runtime design

- Affected: `docs/operations/telegram-ops-control-panel.md`
- Audit evidence: it requires Docker CLI/socket access in the long-running runtime while current environment/production policy forbids that model and supports explicit action-command configuration.
- Risk: reintroducing Docker-socket exposure.
- Preferred direction: rewrite around host-owned commands and current configuration/runtime boundaries.

### Contributor guidance diverges from governing validation/release policy

- Affected: `CONTRIBUTING.md`
- Audit evidence: stale exact Node guidance, legacy broad validation sequence, incomplete release-label set.
- Preferred direction: make it a compact contributor entrypoint that routes volatile details to their canonical owners.

### Active-looking historical execution corpus outside lifecycle control

- Affected:
  - `docs/superpowers/specs/**`
  - `docs/superpowers/plans/**`
  - `docs/drafts/**`
- Risk: detailed completed artifacts can be mistaken for current execution truth.
- Preferred direction: formalize namespace lifecycle and disposition existing ambiguous artifacts without inventing a second durable planning system.

## Duplication/consolidation clusters

- `AGENTS.md` + `.codex/ORCHESTRATION.md` + `.codex/PROJECT.md` + agent SSOT
- `docs/README.md` + `docs/reference/DOCS_IA_MAP.md`
- orchestrator system review + ownership ledger + package README
- V1 tracker + readiness reference + alpha-readiness plan
- homework prompt guide + pedagogy spec + assembly draft + template payload
- docs quality score + gardening scorecard + generated health reports
- package READMEs + backend/frontend SSOT/alignment

## Important lifecycle findings

- `docs/plans/README.md` already defines a good active-plan/archive lifecycle and should be strengthened rather than replaced.
- `docs/superpowers/**` lacks its own explicit lifecycle/index despite being a task-artifact namespace.
- `docs/drafts/**` lacks a router/ownership/lifecycle boundary.
- dated operational evidence and incidents need explicit “evidence, not current procedure” semantics.
- `docs/playbooks/RESTART_TOMORROW.md` contains stale current-state handoff information and should not remain a current-state authority.
- `docs/reference/V1_IMPLEMENTATION_TRACKER.md` is stale and should leave active routing rather than become another maintained current-state owner.
- runtime prompt templates/profiles under `docs/prompt-gallery/**` are application-consumed assets and should have explicit runtime ownership.

## Audit priority framing

### P0 — misleading / dangerous

- correct versioning migration-head drift;
- rewrite Telegram ops prerequisites;
- refresh/replace stale orchestrator current-state references and routes;
- rework `CONTRIBUTING.md`;
- archive/de-route stale V1 continuity/current-session truth.

### P1 — structural cleanup

- formalize `docs/superpowers/**` lifecycle;
- make `docs/README.md` a short router and `DOCS_IA_MAP.md` the detailed matrix;
- separate durable readiness policy, current roadmap, and historical continuity;
- clarify/trim agent-harness duplication without damaging always-loaded usability;
- establish canonical prompt runtime-asset ownership;
- add minimal drafts/prompt-asset navigation/lifecycle guidance;
- correct misleading deployment/document scope where appropriate.

### P2 — quality cleanup

- normalize metadata/authority labels where useful;
- merge/reduce obsolete quality-score/rationale duplication;
- review dated “active” designs/roadmaps against exit triggers;
- tighten package READMEs to package-local information;
- add a small operations evidence/incident route if useful.

### P3 — optional polish

- cross-link/title consistency;
- obsolete model-era guidance after compatibility verification;
- naming/discoverability cleanup;
- low-value profile/example cleanup after ownership/privacy determination.

## Audit uncertainties to resolve from repository evidence

- which `docs/superpowers/**` artifacts remain active for named tasks versus completed history;
- which prompt-gallery profiles are true runtime/bootstrap assets versus examples/history;
- whether older model-specific guidance still supports an authorized compatibility path;
- which older roadmap READMEs still describe intended future work rather than stale status.

## Governing interpretation

Do not treat this audit as the final architecture.

The approved `SPEC.md` and Goal Contract own the intended target state. The audit provides discovery evidence and candidate findings. Current repository state remains authoritative for implementation details.

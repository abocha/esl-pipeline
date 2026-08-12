# Documentation System Overhaul

## Meta

- Audience: maintainer + Codex primary orchestrator.
- Authority Level: active goal-backed execution handoff.
- Last Verified Against: 2026-08-12 repository/audit state.
- Owner: founder-maintainer + primary orchestrator.
- Status: `roadmap`.
- Current Focus: implementation and local verification are complete; prepare the single authorized
  PR and obtain required hosted CI evidence.
- Exit Trigger: archive this plan directory after the overhaul PR merges or is intentionally abandoned.

## Goal Contract

**Mode:** goal-backed

### Objective

Transform the existing ESL Pipeline documentation corpus into one coherent, source-aligned system that preserves useful progressive disclosure while eliminating material semantic drift, competing current-state authorities, ambiguous artifact lifecycles, and the documentation/runtime-resource category boundary identified by the approved specification.

### Completion evidence

- Every confirmed high-risk stale/current documentation finding from the audit is corrected, removed from current routing, or replaced by a canonical source reference.
- Current architecture, operations, contributor, versioning, and primary routing guidance has been verified against the repository surfaces that actually own those facts.
- `docs/README.md` and `docs/reference/DOCS_IA_MAP.md` have clearly distinct category-router and detailed-task-router roles without unnecessary duplicate matrices.
- Durable active plans, Superpowers task artifacts, drafts, operational evidence, and archived material have explicit non-conflicting lifecycle semantics.
- Obsolete V1/current-session handoff artifacts no longer compete as current project truth.
- Existing ambiguous medium/high-risk task/planning artifacts have been dispositioned or explicitly resolved according to the approved lifecycle.
- Runtime prompt templates/profiles no longer masquerade as ordinary documentation and their runtime/bootstrap/build behavior remains semantically unchanged.
- Package/reference consolidation leaves one clear canonical owner for affected global rules while retaining useful package-local documentation.
- Avoidable manually copied volatile facts identified during the overhaul no longer create competing sources of truth.
- Existing healthy archive/history remains intact except for justified lifecycle moves.
- Generated documentation/indexes are synchronized.
- Required documentation and repository-level validation for the final integrated diff passes, or any permitted external/CI-owned evidence is reported exactly according to repository policy.
- The final integrated diff has been inspected against this Goal Contract.
- Any final whole-branch review required by cumulative residual risk has no unresolved material findings.
- No required outcome remains incomplete merely because the current implementation task list has been exhausted.

### Scope

#### In

- tracked ESL Pipeline documentation;
- documentation routing and governance;
- planning/task-artifact lifecycle;
- archive/draft/evidence classification and navigation;
- package README/reference ownership where identified by the audit;
- source verification necessary to make current docs accurate;
- deterministic docs tooling/checks where a small change directly prevents identified recurrence;
- runtime/config/build/test changes strictly necessary to relocate runtime-owned prompt assets without changing their semantic content;
- generated indexes and link/path updates caused by the overhaul.

#### Out

- unrelated product features;
- unrelated source refactors;
- application architecture redesign;
- rewriting healthy archived history;
- stylistic rewriting without information-architecture or correctness value;
- AI-based semantic documentation CI;
- generalized new documentation/lifecycle frameworks;
- changing prompt/profile semantic content;
- deleting uncertain unique history without evidence;
- resolving unrelated low-value polish solely because it appeared in the audit.

### Approved design constraints

- Preserve progressive disclosure and existing SSOT philosophy.
- Reuse existing lifecycle/governance machinery rather than creating a parallel system.
- `docs/plans/**` is the durable active planning surface.
- `docs/superpowers/**` is named-task execution context, not general current truth.
- Drafts are non-authoritative and disposable by default.
- Archive remains historical and non-authoritative.
- Current project status must come from active planning/backlog/evidence, not a manually maintained “restart tomorrow” snapshot.
- Detailed task routing belongs in `DOCS_IA_MAP`; `docs/README` remains a compact category router.
- Preserve the useful always-loaded function of `AGENTS.md`; trim only proven low-value duplication.
- Runtime-consumed prompt assets must have an explicit runtime ownership boundary rather than remaining semantically ordinary docs.
- Prefer canonical source references/generated data over duplicated volatile constants.
- Use one implementation branch and one eventual PR.
- Verification gates are evidence checkpoints, not automatic review checkpoints.
- Review follows residual semantic risk.

### Stop / escalation conditions

Escalate rather than redefining the goal if:

- repository evidence invalidates a material approved design decision;
- completing the runtime-resource separation requires materially changing application architecture or behavior;
- deletion/movement decisions encounter unresolved privacy, retention, data-loss, or unique-history risk;
- a product/runtime contract change becomes necessary;
- an ambiguous roadmap artifact requires a maintainer product-priority decision;
- the one-PR strategy becomes materially unsafe or unreviewable;
- new work cannot be traced to the goal as direct outcome work, a necessary enabler, required validation/risk control, or an evidenced constraint.

Do not escalate ordinary changes to implementation strategy, delegation, file grouping, or commit boundaries that preserve this contract.

## Current Execution Strategy

The implementation strategy is intentionally revisable beneath the Goal Contract.

Use one branch and one eventual PR. Prefer coherent internal commits/checkpoints rather than intermediate PRs.

Initial ownership boundaries:

1. Semantic-current-truth corrections.
2. Lifecycle/router restructuring and stale-current-state cleanup.
3. Task-artifact/draft/evidence disposition and link repair.
4. Runtime prompt-asset ownership relocation.
5. Package/reference consolidation and remaining high-value cleanup.
6. Integrated regeneration, validation, outcome audit, and final review if warranted.

The prior documentation audit is evidence, not a mechanical action list. Verify destructive moves, deletions, and source-sensitive corrections against current repository state.

## Verification Gates

### Gate 0 — Baseline and strategy

Before substantial mutation:

- confirm worktree/branch state;
- read active repository instructions, documentation governance, this Goal Contract, and `SPEC.md`;
- verify the audit's load-bearing high-risk claims against current source/configuration;
- map ambiguous lifecycle/runtime-asset areas far enough to execute safely;
- establish the current implementation strategy;
- capture baseline documentation validation.

Do not perform another generic repository-wide audit.

### Gate 1 — Semantic truth restored

Required outcome:

- confirmed dangerous/stale current guidance is corrected, removed, or de-routed;
- no known current router directs work through obsolete V1/current-handoff truth;
- current architecture/operations/contributor guidance agrees with source and canonical policy;
- avoidable copied volatile values have been replaced by canonical references where appropriate.

Use targeted source/config comparisons plus the applicable documentation checks.

### Gate 2 — Lifecycle and information architecture coherent

Required outcome:

- `docs/plans`, `docs/superpowers`, `docs/drafts`, evidence, and archive semantics are explicit;
- high-risk ambiguous task artifacts are dispositioned;
- `docs/README.md` and `DOCS_IA_MAP.md` have distinct responsibilities;
- current routes do not treat completed task artifacts or drafts as current truth;
- readiness/current-state ownership is singular and clear;
- useful progressive disclosure is preserved.

Regenerate relevant indexes and inspect the resulting tree/routes as a system.

### Gate 3 — Runtime/documentation boundary complete

If runtime prompt assets are relocated:

- runtime ownership is explicit;
- configured defaults resolve;
- bootstrap/import behavior remains correct;
- required package/container/build inclusion remains correct;
- content bytes/semantics are preserved;
- docs tooling no longer misclassifies the runtime assets;
- release/change classification remains correct.

Run focused tests first, then the repository-level gate appropriate to the actual runtime/configuration changes.

### Gate 4 — Integrated outcome

Before PR readiness:

- inspect the complete branch diff;
- map every Goal Contract completion criterion to evidence;
- regenerate all affected indexes;
- format;
- run `pnpm docs:check`;
- run the appropriate broad ESL repository gate for the integrated diff;
- confirm no active route is broken or points to newly historical material;
- confirm generated artifacts are synchronized;
- confirm no unintended prompt/profile content changes occurred;
- account for intentionally deferred audit findings.

After mechanical/integration evidence is green, run one final whole-branch Terra/high review if cumulative cross-document/runtime routing risk remains material. Resolve material findings and restore affected validation evidence.

## Execution Orchestration

Primary: GPT-5.6 Sol / medium.

The primary owns:

- the single root Goal;
- adaptive implementation strategy;
- decomposition/delegation;
- integration;
- verification gates;
- lifecycle/disposition decisions;
- final outcome audit;
- eventual PR readiness.

Use focused `terra_explorer` only when current evidence is insufficient. Do not rerun the broad documentation audit.

Use:

- Luna/xhigh for bounded, well-specified implementation;
- Terra/high where predetermined work has substantial semantic coupling;
- one final Terra/high whole-branch review when cumulative residual risk justifies it;
- Sol/high only if the actual diff introduces an exceptional-risk surface.

Verification gates are not review gates.

## Delivery

One branch, one eventual PR.

Do not create, push, or open the PR unless the user has explicitly authorized those Git mutations for the run.

After the implementation PR merges, move this whole directory into the repository's normal archived-plan location according to the active plan lifecycle policy.

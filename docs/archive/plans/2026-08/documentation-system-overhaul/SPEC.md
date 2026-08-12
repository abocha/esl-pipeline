# ESL Pipeline Documentation System Overhaul Specification

## Status

Historical approved design specification for the completed goal-backed execution in PR #187.

The prior repository-wide documentation audit is the principal discovery input. Its factual findings should be verified where necessary; its proposed actions are recommendations, not mechanically binding instructions.

## 1. Problem

ESL Pipeline already has a strong documentation foundation:

- explicit authority routing;
- progressive disclosure;
- SSOT documents;
- generated indexes;
- a real archive boundary;
- documentation metadata;
- automated documentation checks.

The overhaul must preserve those strengths.

The problem is accumulated semantic, authority, and lifecycle drift:

1. Some active/current documentation is materially stale.
2. Volatile source facts have been copied into prose and drifted independently.
3. Several routing layers repeat one another.
4. Completed or task-specific execution artifacts can look like current plans.
5. Current project state is duplicated in handoff/tracker documents that naturally decay.
6. Runtime prompt assets live under `docs/`, obscuring whether they are documentation or deployable application resources.
7. Drafts and dated operational evidence lack sufficiently explicit lifecycle semantics.
8. Some package READMEs and reference docs repeat global contracts instead of routing to their canonical owner.
9. Mechanical documentation validation can pass while semantically incorrect current guidance remains.

The objective is not to make every document shorter or newer. It is to make the documentation system trustworthy and legible.

## 2. Design principles

### 2.1 Preserve progressive disclosure

Do not flatten the documentation hierarchy into one giant reference.

Useful intentional overlap remains valid when each layer has a distinct job.

### 2.2 Location should communicate semantics

A reader or coding agent should be able to infer whether an artifact is:

- current authoritative guidance;
- an active durable plan;
- task-local execution context;
- runtime application data;
- a draft;
- dated evidence;
- historical material.

### 2.3 One canonical owner per volatile fact

Avoid copying volatile machine-readable facts into prose when a source, generated artifact, or canonical registry can own the value.

Examples include:

- migration heads;
- exact runtime versions;
- exhaustive environment-key inventories;
- current implementation-stage lists when they can instead be generated or directly source-verified.

Prose may explain meaning and policy without manually owning the current value.

### 2.4 Correctness before consolidation

Correct dangerous or misleading current guidance before large-scale movement or prose cleanup.

### 2.5 Canonicalize before rewriting duplicates

When two documents substantially overlap, first determine their distinct responsibilities and canonical owner.

Do not polish both copies.

### 2.6 Delete when preservation has no value

Do not archive everything reflexively.

Use:

- keep for useful current truth;
- archive for historical material worth retaining;
- delete for disposable execution residue or drafts with no durable value.

### 2.7 Do not build a new documentation-governance subsystem

Reuse the existing lifecycle metadata, archive, routing, generated indexes, and docs checks.

Add new machinery only where a concrete gap cannot be handled by the existing system.

## 3. Target documentation model

### 3.1 Current truth

Current repository/documentation surfaces include:

- `README.md`
- `AGENTS.md`
- `.codex/**`
- `docs/README.md`
- `docs/reference/**`
- `docs/backend-frontend/**`
- `docs/operations/**`
- `docs/design/**`
- package-local `README.md` files

These may route elsewhere, but when they describe present behavior they must remain source-aligned.

### 3.2 Durable active planning

`docs/plans/**` remains the only durable active planning system.

Use it for:

- ongoing roadmaps;
- active workstreams;
- editable multi-session plans;
- backlogs whose status remains operationally relevant.

Completed or superseded execution plans leave this tree according to the existing lifecycle contract.

### 3.3 Task-local execution artifacts

Formalize `docs/superpowers/**` as a temporary named-task artifact workspace, not a second durable planning hierarchy.

A file there is authoritative only for the explicitly named task/spec/implementation context that invokes it.

Existence in this directory does not make the artifact current repository truth.

After implementation concludes, the responsible change must decide whether to:

- delete it because it has no durable value; or
- move it into a clearly historical task-artifact archive when retaining design/execution history is useful.

Add a concise namespace README and integrate the rule into existing documentation governance/checking where proportionate.

Do not create elaborate per-file lifecycle machinery merely to manage this directory.

### 3.4 Drafts

Formalize `docs/drafts/**` as:

- non-authoritative;
- excluded from current-task routing;
- disposable by default.

When a draft resolves:

- promote durable conclusions into their real owner;
- archive it only when historical rationale is genuinely valuable;
- otherwise delete it.

Add only the minimum README/lifecycle guidance necessary.

### 3.5 History

`docs/archive/**` continues to mean historical and non-authoritative.

Do not churn the healthy archive merely to normalize old prose or metadata.

### 3.6 Operational evidence

Give dated operational evidence an explicit discoverability/lifecycle convention.

Prefer an indexed evidence area beneath operations when that improves operator discovery, while preserving nearby evidence where locality clearly helps.

The invariant matters more than a perfectly uniform folder tree:

> dated evidence is evidence, never the current procedure.

Do not move large collections solely for aesthetic consistency.

### 3.7 Runtime assets

Runtime-consumed prompt templates and profiles must stop being semantically classified as ordinary documentation.

Preferred end state:

- move them from `docs/prompt-gallery/**` into an explicit runtime-owned resource location;
- choose the exact location after tracing bootstrap, package, image, configuration, and deployment ownership;
- prefer the nearest real runtime owner rather than inventing a generic top-level framework.

Update as needed:

- default paths;
- bootstrap/import tooling;
- image/package inclusion;
- documentation;
- tests;
- release-path classification;
- generated indexes/tooling that currently treats those files as docs.

Preserve prompt/profile bytes and runtime semantics unless a separate approved decision explicitly changes their content.

If repository evidence shows relocation would require a materially different runtime architecture or create significant privacy/data-retention implications, stop and escalate instead of improvising.

## 4. Required overhaul outcomes

### 4.1 Semantic safety

Resolve all confirmed high-risk stale current guidance from the audit, including at minimum:

- versioning/migration-head drift;
- current orchestrator architecture/stage documentation;
- Telegram operations command/runtime prerequisites;
- contributor validation/runtime/release guidance;
- obsolete V1/current-work routing;
- stale context-recovery routing.

Prefer removing duplicated volatile values when that prevents recurrence.

### 4.2 Current-project-state cleanup

`RESTART_TOMORROW.md` must no longer function as a tracked current-state record.

If a reusable context-recovery procedure remains useful, replace the concept with a timeless procedure that resolves current state from authoritative sources such as:

- current branch/worktree;
- canonical GitHub issue/backlog;
- active plan;
- current evidence.

Do not encode “current chunk” or similarly ephemeral project state in a timeless playbook.

The obsolete V1 tracker should be archived, replaced with a pointer, or removed from active routing rather than updated into another competing current-state owner.

### 4.3 Router hierarchy

Give the two main documentation routers distinct responsibilities.

`docs/README.md`:

- short category-level entrypoint;
- obvious canonical starting surfaces;
- no exhaustive duplicate task matrix.

`docs/reference/DOCS_IA_MAP.md`:

- detailed task-to-document routing matrix.

Update stale routes as part of the same overhaul.

### 4.4 Agent harness

Preserve `AGENTS.md` as the useful always-loaded compact operating contract.

Do not rewrite it merely because another document contains related information.

Trim only duplication whose removal demonstrably improves the always-loaded contract without forcing routine agents to load another document for basic:

- workflow selection;
- non-negotiables;
- role routing;
- normal validation;
- authorization boundaries;
- definition of done.

Detailed mechanics should live in their existing `.codex` owners.

### 4.5 Architecture/reference consolidation

For overlapping current references:

- decide distinct ownership first;
- merge only when maintaining separate documents has no useful semantic purpose;
- otherwise narrow each document to its distinct role.

For orchestrator documentation:

- maintain one source-verified current architecture/system map;
- keep a separate ownership/decision ledger only if it contains genuinely distinct decision information;
- keep package README content package-local.

### 4.6 Readiness/planning separation

Separate:

- durable readiness/product criteria;
- the current active readiness roadmap;
- historical implementation continuity.

Do not maintain multiple files as competing “where are we now?” documents.

### 4.7 Package READMEs

Package READMEs should primarily own:

- package purpose;
- local entrypoints;
- local commands;
- package-local invariants;
- links to broader contracts.

Move or remove repeated global policy where a canonical reference already owns it.

Do not mechanically shorten concise useful package READMEs.

### 4.8 Documentation-governance cleanup

Preserve the existing docs governance/playbook machinery.

Consolidate obsolete scorecards/rationale docs where they duplicate generated health artifacts or each other.

Do not invent a new scoring framework.

### 4.9 Model-era and obsolete guidance

Old model-specific guidance, superseded prompt drafts, completed plans, and similar material should be:

- archived when useful as historical evidence;
- deleted when it has no durable value;
- retained as current only when an actual supported compatibility path still requires it.

Verify before deleting compatibility guidance.

## 5. Audit interpretation rules

The previous documentation audit is evidence, not a script.

The primary must:

- accept well-supported factual findings unless current repository evidence contradicts them;
- independently verify destructive moves/deletions and important current-state corrections;
- reconsider recommended actions such as `FULL_REWRITE`, `ARCHIVE`, or `MERGE` when evidence supports a cheaper or clearer resolution;
- resolve all confirmed high-risk findings;
- resolve structural lifecycle/authority findings that block the target architecture;
- explicitly decide medium/high-risk uncertain areas relevant to the goal;
- address lower-priority issues when they materially support the new architecture or are inexpensive while touching the same boundary;
- avoid low-value polish churn.

A successful overhaul does not require changing every audited artifact.

## 6. Non-goals

Do not:

- rewrite the healthy archive;
- rewrite correct docs merely for stylistic preference;
- enforce uniform length;
- add AI semantic review to CI;
- create a new documentation database or generalized lifecycle engine;
- create metadata merely to make classification more sophisticated;
- change product/runtime behavior except where necessary to relocate runtime-owned resources without semantic change;
- alter prompt/profile content as part of moving runtime assets;
- redesign the underlying application architecture;
- reorganize unrelated source code;
- manufacture review stages for every documentation batch.

## 7. Commit and PR strategy

Use one branch and one eventual PR.

Use coherent commits as internal rollback/reasoning boundaries when helpful.

Do not create intermediate PRs solely to represent verification gates.

The eventual PR should tell one coherent story:

> Make the ESL Pipeline documentation system source-aligned, lifecycle-explicit, and unambiguous about current truth versus task artifacts, runtime resources, and history.

## 8. Definition of success

The overhaul is successful when a maintainer or coding agent can reliably determine:

1. where to begin;
2. where current authoritative truth lives;
3. where ongoing durable planning lives;
4. whether a task artifact is still authoritative for their task;
5. which content is runtime application data rather than documentation;
6. what is merely a draft;
7. what is dated evidence;
8. what is historical;
9. which source owns volatile facts;
10. whether the repository's documented commands/contracts agree with the repository itself.

The result should contain fewer competing truths, not merely newer prose.

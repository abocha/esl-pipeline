# GitHub Issue Intake and Local Codex Work Selection

## Meta

- Audience: maintainers, ChatGPT intake, and local Codex sessions.
- Authority Level: operations runbook.
- Last Verified Against: 2026-10-01 repository and tracker workflow.
- Owner: founder-maintainer + automation agents.
- Review Cadence: after several real reports or a workflow change.
- Status: `runbook`.

ESL Pipeline uses two tracker layers with different ownership:

- Linear team `Abocha` is the canonical planning backlog and durable working memory.
- Linear team `ESL Execution`, synchronized two-way with this GitHub repository, owns concrete
  repository execution records.
- GitHub Issues is the repository-native view of that execution layer and remains the natural place
  for PR, CI, release, migration, rollout, and incident-remediation linkage.

Do not maintain the same planning state independently in both systems.

## Tracker boundary

Use `Abocha` for work whose main purpose is deciding, remembering, prioritizing, investigating, or
sequencing:

- ideas and paper cuts;
- product or architecture decisions;
- investigations before an implementation boundary exists;
- roadmaps and epics;
- deferred work and watch items;
- prioritization and dependency planning.

Promote work to `ESL Execution` when there is a bounded repository-native execution contract that
benefits from one or more of:

- concrete implementation scope and acceptance criteria;
- a PR/CI merge lifecycle;
- migration or release tracking;
- production rollout/recovery evidence;
- incident remediation tied to repository changes;
- cross-PR execution discussion.

For new execution work, create the issue in `ESL Execution` and let the configured Linear↔GitHub
Issues integration create/synchronize the GitHub issue. Do not manually create a second copy.
Pre-existing GitHub execution issues that predate this split may finish in place.

Repository-generated operational records such as docs-gardening issues may remain GitHub-native when
the repository automation itself owns their lifecycle.

## Intake sequence

When a bug, concern, investigation, improvement, experiment, or idea is described conversationally:

1. Preserve the reporter's meaning and uncertainty. A voice note is sufficient input.
2. Search Linear planning memory first for likely duplicates or related decisions. Search current
   GitHub execution issues when the report may already belong to active repository work.
3. If a matching planning item exists, update it rather than creating a cosmetic duplicate.
4. If the report is still planning, investigation, or future work, capture it in `Abocha` with the
   appropriate status, priority, one Type label, and one primary Area label.
5. If there is already a concrete execution boundary, create or promote it into `ESL Execution`.
   Let issue sync create the GitHub counterpart.
6. Do not start code changes merely because an issue was recorded. Execution still follows current
   authorization and repository workflow.

## Evidence language

Keep these categories distinct in planning and execution records:

- **Confirmed evidence:** directly observed, reproduced, measured, or supported by a source.
- **Strong inference:** a conclusion that follows from evidence but is not directly observed.
- **Current hypothesis:** a possible cause or explanation that still needs validation.
- **Proposed solution:** a suggested change from the discussion, not proof that the change is right.

Do not turn a tentative report into a confirmed fact. If validation disproves the initial theory,
update the owning Linear/GitHub record rather than implementing the suggested fix blindly.

## Sensitive data

Redact API keys, access tokens, credentials, complete `.env` files, and secrets embedded in logs
before filing. Avoid unnecessary student personal information and raw lesson content when a technical
summary or safely anonymized excerpt is enough. Preserve the minimum evidence needed to reproduce or
assess the problem.

## GitHub labels

GitHub labels are repository classification aids, not the planning workflow state.

Useful type labels include:

| Label                | Meaning                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `type:bug`           | Confirmed incorrect behavior.                                                        |
| `type:investigation` | Repository-native investigation whose execution/evidence belongs with the repo.       |
| `type:improvement`   | Improve existing behavior, workflow, quality, or ergonomics.                         |
| `type:experiment`    | A concrete repository experiment or evidence-gathering execution task.                |

Area labels remain optional. Use only a natural existing fit such as `area:tts`,
`area:generation`, `area:frontend`, `area:backend`, `area:infra`, or
`area:student-memory`.

Do not use GitHub `status:*` labels as workflow state and do not use `effort:*` labels for work
selection. Planning status, priority, dependencies, and sizing belong in Linear.

## Execution issue guidance

A GitHub execution issue should contain only the detail useful beside the repository:

- concrete goal/scope;
- non-goals where they prevent accidental expansion;
- acceptance criteria;
- current repo/production evidence that matters to execution;
- migration, CI, rollout, or recovery constraints;
- links back to the owning Linear planning item when relevant.

Do not copy a full roadmap or planning history into GitHub merely for symmetry.

## Work selection

Select work from Linear rather than GitHub status labels.

1. Start from `Abocha` when choosing among priorities, investigations, or deferred work.
2. Start from `ESL Execution` when choosing already-approved concrete repository execution.
3. Read the complete top candidate and any linked GitHub execution issue before editing.
4. Reproduce or otherwise validate the reported behavior/current contract when the task depends on a
   defect hypothesis.
5. Prefer the smallest durable change with focused regression coverage where behavior changes.
6. Escalate material architecture, security, authorization, privacy, data-integrity, concurrency,
   migration, or production decisions rather than silently widening execution scope.

GitHub search remains useful for repository evidence and grandfathered execution records, but it is
not the prioritization queue.

## Pull request linkage and automation

For synchronized execution work, keep the Linear execution identifier in the branch/PR linkage used
by the configured GitHub integration. Team automation may move execution issues through
`In Progress`, `In Review`, and `Done` based on PR activity.

Do not manually mirror those status transitions in GitHub labels.

A planning item in `Abocha` may remain open after one execution child is merged when the broader
outcome still has additional slices.

## Completion semantics

An execution issue remains open while its acceptance criteria, required evidence, or stated
dependencies are incomplete. A linked PR is not itself proof of completion unless the execution
contract intentionally ends at merge.

Use `Fixes #N` only when merging that PR should close the GitHub execution issue. Production
rollout, destructive cleanup, or environment verification may need a separate execution record rather
than keeping an implementation issue artificially open.

When an execution slice completes:

- allow GitHub/Linear execution sync and PR automation to close the execution record where applicable;
- update the owning `Abocha` planning item with the result;
- mark the planning item Done only when its broader outcome is actually complete.

If follow-up work is discovered, record it in Linear first and promote a new execution slice only
when the repository-native boundary is concrete.

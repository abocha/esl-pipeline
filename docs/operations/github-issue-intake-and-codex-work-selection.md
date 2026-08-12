# GitHub Issue Intake and Local Codex Work Selection

## Meta

- Audience: maintainers, ChatGPT intake, and local Codex sessions.
- Authority Level: operations runbook.
- Last Verified Against: 2026-08-12 repository and GitHub state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: after several real reports or a workflow change.
- Status: `runbook`.

GitHub Issues is the only canonical engineering backlog for ESL Pipeline. This procedure is a
small, manual handoff between conversational intake and an explicitly selected local Codex session.
It does not create a second tracker, automatic dispatch, or an agent-working state.

## Intake sequence

When a bug, concern, investigation, improvement, or experiment is described conversationally:

1. Preserve the user's meaning and uncertainty. A voice note is sufficient input; the reporter does
   not need to rewrite it into a formal ticket.
2. Search for duplicates before creating an issue. Search open issues first, then related closed
   issues when the symptom, component, or error message suggests prior work. Inspect the complete
   candidates rather than relying on titles alone.

   ```bash
   gh issue list --state open --search "<symptom or component>"
   gh issue view <number>
   ```

3. If a matching issue exists, add the new evidence or link the related report instead of creating
   a cosmetic duplicate. Create a separate issue only when the scope or acceptance criteria differ,
   and note the relationship.
4. Capture the smallest useful problem statement and acceptance criteria supported by the evidence.
   Use the issue body to preserve context, not to make every report conform to a ceremony.
5. Apply exactly one `status:*` label to each open issue in this workflow. Add a type when clear,
   an effort estimate when the issue is ready, and an area only when one of the existing areas is a
   natural fit.
6. Return the issue link and a short summary of what was recorded. Do not start code changes merely
   because an issue was created.

## Evidence language

Keep these categories distinct in the issue body:

- **Confirmed evidence:** directly observed, reproduced, measured, or supported by a source.
- **Strong inference:** a conclusion that follows from evidence but is not directly observed.
- **Current hypothesis:** a possible cause or explanation that still needs validation.
- **Proposed solution:** a suggested change from the discussion, not proof that the change is right.

Do not turn a tentative voice-note statement into a confirmed fact. If validation disproves the
initial theory, update the issue with the result and change its status rather than implementing the
suggested fix blindly.

## Sensitive data

Redact API keys, access tokens, credentials, complete `.env` files, and secrets embedded in logs
before filing. Avoid unnecessary student personal information and raw lesson content when a
technical summary or safely anonymized excerpt is enough. Preserve the minimum evidence needed to
reproduce or assess the problem.

## Labels

Open issues brought into this workflow carry one status label:

| Label            | Meaning                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| `status:inbox`   | Recorded, but incomplete or not yet actionable without clarification.          |
| `status:ready`   | Local Codex can begin after reading the issue and validating the problem.      |
| `status:blocked` | A stated dependency, missing evidence, or required decision prevents progress. |

Use the following type labels when the distinction is supported:

| Label                | Meaning                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `type:bug`           | Confirmed incorrect behavior.                                                        |
| `type:investigation` | Suspicious behavior or a technical question whose defect status is uncertain.        |
| `type:improvement`   | Current behavior is valid but undesirable, or the workflow itself needs improvement. |
| `type:experiment`    | A comparison or evidence-gathering task must precede a direction.                    |

Effort labels are rough local-session selection hints, not promises:

| Label             | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `effort:quick`    | Localized, reproducible, and low uncertainty.                                          |
| `effort:standard` | Several files, meaningful debugging, or a moderate test surface.                       |
| `effort:deep`     | Architectural, poorly understood, or likely to consume a large session/context budget. |

Area labels are optional. Use only the existing natural fits: `area:tts`, `area:generation`,
`area:frontend`, `area:backend`, `area:infra`, and `area:student-memory`. Do not add an area just
to classify an issue that does not fit one.

## Issue body guidance

Use only sections supported by the available evidence. Useful sections include:

- Summary
- Observed behavior
- Expected behavior
- Impact
- Reproduction context
- Confirmed evidence
- Current hypotheses
- Unknowns
- Suggested investigation
- Acceptance criteria
- Related issues / PRs

Empty ceremonial headings are not required. A short issue with a clear observation and next
evidence needed is better than a complete-looking template filled with guesses.

## Local Codex work selection

When asked to choose work for a constrained session:

1. List open issues labeled `status:ready`.
2. Match `effort:quick`, `effort:standard`, or `effort:deep` to the available time and quota.
3. Read the complete top candidates and consider impact, reproducibility, uncertainty, dependencies,
   and likely context size.
4. Recommend one issue and explain the fit before editing, unless the user has already authorized
   that exact implementation.
5. Reproduce or otherwise validate the reported behavior and current contract before implementing.
   Treat issue hypotheses and proposed fixes as inputs to test, not as established causes.
6. Prefer the smallest durable change, with focused regression coverage where behavior changes.
   Escalate when validation reveals an architectural, security, authorization, privacy, data
   integrity, concurrency, migration, or production decision rather than silently broadening scope.

Useful searches are:

```bash
gh issue list --state open --label 'status:ready' --json number,title,labels
gh issue list --state open --label 'status:ready' --label 'effort:quick'
gh issue view <number>
```

## Completion semantics

An issue remains open while its acceptance criteria, required evidence, or stated dependencies are
incomplete. A linked PR is not itself proof of completion. Close the issue only when the acceptance
criteria are genuinely satisfied and the issue or PR records the relevant evidence; use `Fixes #N`
only when merging that PR should close the issue. If follow-up work is discovered, record it as a
separate issue instead of quietly expanding the original. GitHub's closed state represents done;
there is intentionally no `status:done` label.

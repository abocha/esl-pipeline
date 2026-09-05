---
name: esl-pipeline-pr-ci-babysit
description: Use when an esl-pipeline pull request needs template cleanup, release-label verification, exact GitHub Actions failure diagnosis, CI monitoring, or one explicitly authorized fix-and-push pass.
---

# ESL Pipeline PR and CI follow-up

Operate on live PR or GitHub state only to the extent explicitly authorized by the user. Do not
turn a request to inspect or explain into a PR edit, push, review submission, or CI watch.

## Establish live state

1. Read `AGENTS.md`, `.github/pull_request_template.md`, and the relevant repository-administration
   sections routed through `docs/reference/agents-ssot.md`.
2. Read `docs/reference/VERSIONING_MODEL.md` before selecting a release label.
3. Retrieve the live PR body, labels, head branch, URL, and checks with `gh`; do not reconstruct them
   from memory or a local diff alone.
4. Infer from the request and applicable prior authorization whether the scope is:
   - report only;
   - PR body or label correction;
   - one CI fix and push;
   - continuous CI monitoring through green.
     Ask only if a material authorization boundary remains unresolved.

For report-only requests, report discrepancies without correcting metadata, changing code, pushing,
or starting a watch. The correction steps below apply only within authorized scope.

## Normalize PR metadata

- Use the template sections exactly: `Summary`, `Validation`, `Risk Notes`, and `Checklist`.
- List only validation commands actually run.
- Require exactly one release label allowed by the current versioning policy.
- Stop and ask when the release-label choice is ambiguous.
- Re-read the live PR after any authorized edit and verify its body and labels.

## Diagnose CI from exact evidence

1. Identify the exact failing job with `gh pr checks` or `statusCheckRollup`.
2. Open that job's log before changing code. Do not diagnose from a neighboring summary.
3. Reproduce the exact failing command locally when practical.
4. Apply the narrowest correction supported by the failure evidence.
5. Run the focused command, then the repository gate required by `AGENTS.md`.
6. Push only when the user authorized a push.

If the user requested monitoring, resume `gh pr checks <pr-number> --watch --interval 30` after an
authorized fix. If the user requested one fix without babysitting, stop after the verified push and
do not claim the hosted rerun result.

## Common failure handling

- If job logs are unavailable while a workflow is running, try the job-level log. If it is also
  unavailable, report the evidence gap; wait only within authorized monitoring scope. Do not infer
  a cause or change code from a neighboring summary.
- If a local branch tracks the wrong upstream, inspect the branch and upstream before using an
  explicit destination such as `git push -u origin HEAD:<branch>`.
- If a gate times out, inspect `tmp/check-logs` before classifying it as failed or rerunning.
- If labels are missing or duplicated, report them; when correction is authorized, correct and
  re-query them before reporting completion.

## Completion evidence

Report the PR URL, metadata changes made, exact commands run, focused and canonical validation
results, current hosted-check state, and whether monitoring was or was not requested.

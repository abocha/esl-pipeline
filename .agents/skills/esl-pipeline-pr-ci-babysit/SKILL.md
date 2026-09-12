---
name: esl-pipeline-pr-ci-babysit
description: Use only when work directly operates on an ESL Pipeline pull request or its hosted CI state, including PR metadata, release-label verification, hosted failure diagnosis, check monitoring, or an explicitly authorized fix-and-push pass. Do not use for routine local validation before a PR exists.
---

# ESL Pipeline PR and hosted CI follow-up

Use live GitHub evidence and keep PR/CI actions inside the user's authorized scope.

## Live state first

- Read the current PR body, labels, head, and checks rather than reconstructing them from memory or local state.
- Use the current PR template and versioning policy when metadata or release labels matter.
- PR validation text must describe validation actually performed.
- A PR must have exactly one release label permitted by current repository policy.

A request to inspect, explain, or diagnose does not authorize editing PR metadata, changing code, pushing, submitting reviews, or monitoring checks.

## Diagnose the exact hosted failure

Start from the failing hosted job and its own logs/artifacts. Do not infer the cause from a neighboring job, summary, or stale local result.

Reproduce locally only when doing so can resolve a concrete uncertainty. Match the hosted command, configuration, prerequisites, or resource conditions that matter instead of substituting an unrelated broad local gate.

Inspect retained validation artifacts before rerunning unchanged work.

Apply a code fix or push only when that mutation is authorized.

## Monitoring boundary

Monitoring through a later hosted result is a separate requested activity. Authorization for one fix or push does not by itself require or authorize continued babysitting.

After an authorized PR metadata change or push, re-read the relevant live state before claiming the mutation succeeded.

## Completion

Report the PR identity, mutations actually made, exact hosted/local evidence used, current check state, and any remaining CI or maintainer-owned action. Do not claim a hosted rerun result that was not observed.
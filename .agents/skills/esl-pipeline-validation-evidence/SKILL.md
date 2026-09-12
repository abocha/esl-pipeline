---
name: esl-pipeline-validation-evidence
description: Use only when changing ESL Pipeline validation or hosted-CI policy/topology, backend test-project classification, service-test infrastructure, validation evidence machinery, or when diagnosing a failure of that validation system itself. Do not use merely to validate an ordinary application or documentation change.
---

# ESL Pipeline validation-system changes

This skill governs the validation system itself, not routine validation of feature work.

Current `AGENTS.md` and testing documentation own the normal validation policy and commands.

## Preserve the validation model

- Focused local evidence is the normal development path; hosted PR CI owns comprehensive merge regression.
- Do not make repository-wide local gates an automatic prerequisite for ordinary changes.
- When diagnosing hosted CI, start from the exact selected job, logs/artifacts, configuration, and prerequisites rather than approximating it with a broader local command.
- Inspect existing persisted evidence before rerunning unchanged work.

## When changing validation infrastructure

Inspect only the affected validation owners, such as the current testing guidelines, CI workflow, change-scope logic, backend test-project configuration, or service-test helpers.

Preserve these semantic properties where applicable:

- hosted scope selection fails closed for changes it cannot safely classify;
- workspace/dependency impact includes required transitive dependents;
- test projects are classified by actual imports, bootstrap, and operational prerequisites rather than filename convention alone;
- tests intended to be pure are isolated from ambient service/provider/repository environment;
- service-test helpers remain narrow tools for their real callers rather than becoming a second generalized local CI orchestrator.

Treat current scripts, environment values, project names, and command spelling as repository-owned implementation details, not durable skill content.

Historical artifacts may document commands that once ran; they are evidence, not current procedure and do not by themselves justify compatibility aliases.

## Completion

Validate the changed validation machinery with the narrowest reliable evidence that proves its intended behavior.

Report what validation/CI behavior changed, the evidence obtained, and which hosted, manual, or environment-owned requirements remain. Do not convert a focused local pass into a claim of merge readiness.
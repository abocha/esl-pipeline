---
name: esl-pipeline-deployment-change-checklist
description: Use only when ESL Pipeline work changes, diagnoses, rehearses, or executes production deployment surfaces such as production Compose/GHCR, Caddy or nginx edge routing, deploy/backup/health tooling, or production environment contracts. Do not use for ordinary application changes merely because they will eventually be deployed.
---

# ESL Pipeline deployment changes

Apply production-specific guardrails while current repository sources own exact deployment procedure.

## Durable guardrails

- Repository changes do not authorize live VPS mutation.
- Keep production application deployment pull-based with immutable commit-addressed images unless an approved design explicitly changes that architecture.
- Do not reintroduce production image builds, local deployment tags, `pull_policy: never`, `up --build`, backend Docker socket mounts, or long-running backend Docker/AWS CLIs.
- Keep deployment state outside the application checkout.
- Preserve the public route `browser -> Caddy -> batch-frontend nginx -> /api/* -> batch-backend` unless an approved design changes it.
- Keep PostgreSQL, Redis, and backend services off the public interface by default.
- Treat a probe as a mutation when it creates jobs, calls paid providers, changes runtime state, recreates services, or otherwise has side effects.

## Route from the actual change

Inspect only the current sources relevant to the affected surface. Typical owners include production Compose, deployment/operations docs, environment-contract references, edge configuration, and `scripts/deploy/*` or `scripts/docker/*`.

Use live repo sources rather than copying deployment commands or current configuration from this skill.

When behavior or an operator/environment contract changes, update its owning documentation in the same change.

## Authorization and completion

Live deployment, production environment edits, service recreation, backup/restore actions, and other production mutations require authorization covering those actions. Existing authorization remains valid within its scope.

Validate according to current repository policy and the affected deployment surface rather than running broad checks by default.

Report the deployment topology or contract changed or preserved, evidence actually obtained, live actions intentionally not performed, and any required operator follow-up.
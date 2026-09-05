---
name: esl-pipeline-deployment-change-checklist
description: Use when esl-pipeline work touches production Compose, GHCR image deployment, Caddy edge routing, backup or health tooling, production environment contracts, deployment docs, or rehearsal readiness.
---

# ESL Pipeline deployment change checklist

Keep repository-side deployment changes aligned with the pull-based production architecture.
Repository edits never imply authorization to deploy or otherwise mutate the VPS.

## Establish scope and authority

1. Determine whether the request is review, repository implementation, deployment rehearsal, or a
   live deployment. Stop before live mutation unless it is explicitly authorized.
2. Read `AGENTS.md` and `docs/reference/agents-ssot.md`.
3. Read the smallest relevant source set:
   - `docker-compose.prod.yml`
   - `docs/backend-frontend/DEPLOYMENT.md`
   - `docs/operations/production-env-checklist.md`
   - `docs/alpha-deployment-decisions.md`
   - `docs/reference/env.md` for environment-contract changes
   - `packages/batch-frontend/nginx.conf` for same-origin routing
   - relevant `scripts/deploy/*` or `scripts/docker/*`
4. Use `docs/reference/DOCS_IA_MAP.md` only when the documentation route is unclear.

## Preserve production invariants

- Keep application services pull-based with SHA-tagged GHCR image references.
- Keep deployment state outside the checkout under `/var/lib/esl-pipeline/deploy`.
- Do not introduce production `build:`, local tags, `pull_policy: never`, `up --build`, backend
  Docker socket mounts, or long-running backend Docker/AWS CLIs.
- Preserve the public path `browser -> Caddy -> batch-frontend nginx -> /api/* -> batch-backend`.
- Keep PostgreSQL, Redis, and backend services off the public interface unless an approved design
  explicitly changes that contract.
- Keep Windows development and the Ubuntu VPS in scope; prefer cross-platform wrappers over
  shell-specific host-path expansion.

## Change and validate

- For review-only work, validate concrete concerns and return findings without editing.
- For implementation, update behavior docs and environment references in the same change.
- Inspect `validate-edge-env.mjs` and `validate-caddy-config.mjs` before changing Caddy validation.
- Regenerate documentation indexes when an indexed environment, command, or operations surface
  changes.
- Run focused tests first, then the validation routed by `AGENTS.md`. Deployment-related changes
  commonly require `pnpm docker:lint`, production Compose config validation, and `pnpm docs:check`.
- Deploy execution, production environment edits, service recreation, backups, and restores require
  explicit authorization covering those actions. Do not request authorization again when it already
  applies. Read-only status, logs, and health inspection may be part of an authorized investigation;
  inspect unfamiliar probes before assuming they are read-only. A probe that creates jobs, calls paid
  providers, or changes runtime state needs the corresponding mutation authorization.

## Completion evidence

Report:

- the preserved or changed topology;
- files and contracts affected;
- commands actually run and their results;
- deployment or operator steps that remain intentionally unperformed;
- any required production follow-up.

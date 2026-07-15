# Selective Production Deploy Implementation Plan

> **For Codex:** Execute this plan test-first, keeping the release bundle complete even when only some images are rebuilt.

**Goal:** Stop rebuilding, pulling, migrating, and restarting unchanged production services while preserving one SHA-addressable release bundle and the existing one-command VPS deployment.

**Architecture:** A repository classifier maps the merged PR diff through workspace dependencies to the three production images. The release workflow builds changed images and server-side retags unchanged image digests. The VPS script resolves all requested image digests, locally aliases unchanged images, computes a deployment plan from current state plus the Caddy configuration digest, and performs only required operational work.

**Tech Stack:** Node.js ESM tooling/tests, GitHub Actions, Docker Buildx/GHCR, Bash, Docker Compose, Caddy.

---

## Task 1: Classify production image scope

**Files:**

- Create: `scripts/release/production-image-scope.mjs`
- Create: `scripts/release/resolve-production-image-scope.mjs`
- Create: `scripts/release/production-image-scope.test.mjs`

1. Add failing tests for frontend-only, shared-contract, prompt-gallery, infrastructure-only, root dependency, rename, unknown-root, and malformed/empty diff cases.
2. Run `node --test scripts/release/production-image-scope.test.mjs` and confirm the missing-module failure.
3. Implement `buildProductionImageScope({ changedFilePayload, workspacePackages })` using the committed PR file payload, workspace ownership, and transitive dependents. Unknown or malformed input must fail closed to all images.
4. Implement a CLI that writes `build_backend`, `build_frontend`, and `build_bot` to `GITHUB_OUTPUT` and a readable explanation to the step summary.
5. Rerun the focused test to green.

## Task 2: Publish a complete release bundle selectively

**Files:**

- Modify: `.github/workflows/release-on-merge.yml`
- Modify: `scripts/release/release-workflow-structure.test.mjs`
- Modify: `scripts/docker/production-image-contract.test.mjs`

1. Add failing structure assertions that changed files are always collected, image scope is exported, Docker actions are commit-pinned, changed images use `docker/build-push-action` with GHA cache scopes, and unchanged images use `imagetools create` from the previous release tag.
2. Run the two focused test files and capture the expected failures.
3. Make file collection unconditional. Export the previous version tag from the release job and feed the classifier output to the publish job.
4. Replace raw Buildx setup/login/build commands with pinned Docker actions. Build only changed images; retag unchanged images to both the release SHA and semantic version tag without transferring layers through the runner.
5. Rerun both focused test files to green.

## Task 3: Make deployment planning deterministic

**Files:**

- Create: `scripts/deploy/deploy-prod-images-plan.sh`
- Create: `scripts/deploy/deploy-prod-images-plan.test.mjs`

1. Add failing executable tests for first deploy, backend-only, frontend-only, bot-only, Caddy-only, and alias-only releases.
2. Run `node --test scripts/deploy/deploy-prod-images-plan.test.mjs` and confirm the missing-library failure.
3. Implement a side-effect-free Bash planner that exposes change flags and the exact Compose services to recreate. Backend changes must include its workers, frontend, and edge; frontend changes must include frontend and edge; disabled bot changes must not start the bot.
4. Rerun the focused planner test to green.

## Task 4: Apply the deployment plan safely

**Files:**

- Modify: `scripts/deploy/deploy-prod-images.sh`
- Modify: `scripts/deploy/deploy-prod-images.test.mjs`

1. Extend static/behavior tests to require remote digest resolution, local aliasing for unchanged images, Caddy digest persistence, conditional backup/migration, selective Compose service updates, and bounded health checks.
2. Run the deploy tests and capture the failures.
3. Resolve each requested GHCR manifest digest before pulling. When it matches the current recorded digest and the current image exists locally, tag it locally to the new SHA instead of pulling it.
4. Persist `CADDY_CONFIG_DIGEST`, source the planner, copy current state to previous before mutation, run backup/migration only for backend changes, and recreate only planned services. Treat missing Caddy state as changed for the first upgraded deploy.
5. Preserve rollback, promotion, and health verification; keep deeper worker/S3/migration checks conditional on backend changes.
6. Rerun deploy and Docker tooling tests to green.

## Task 5: Synchronize operator documentation

**Files:**

- Modify: `docs/backend-frontend/DEPLOYMENT.md`
- Modify: `docs/operations/production-env-checklist.md`
- Modify: `docs/alpha-deployment-decisions.md`

1. Document the unchanged operator command and the new selective behavior.
2. Explain complete release bundles, server-side retagging, local digest aliases, Caddy digest state, conditional database work, restart propagation, first-upgrade behavior, and rollback boundaries.
3. Run `pnpm docs:check` and fix any generated or freshness issues caused by the edits.

## Task 6: Validate and publish the branch

1. Run focused Node tests for release, Docker, and deployment tooling.
2. Run `pnpm format:write`, `pnpm format`, `pnpm run lint:repo-hygiene`, and `pnpm --silent run check:fast:agent`.
3. Because this crosses release and production deployment infrastructure, run `pnpm check:pre-pr` and inspect any terse failure artifacts.
4. Run `pnpm docs:check`, `git diff --check`, and a final branch diff review.
5. Commit focused changes using Conventional Commit messages, push the branch, create one ready PR with exactly one `release:patch` label, and monitor the initial CI result. Do not deploy.

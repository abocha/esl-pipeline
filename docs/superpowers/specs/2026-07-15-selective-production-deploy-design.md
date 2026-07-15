# Selective Production Image Publication and Deployment Design

## Status

Approved for implementation on 2026-07-15.

## Problem

Every versioned merge currently rebuilds and republishes all three application images. The
production deploy script then pulls backend and frontend images, creates a database backup, runs
migrations, updates the full application stack, and recreates Caddy regardless of which runtime
surface changed.

The Debian runtime migration exposed the cost of that coupling. A frontend-only release rebuilt a
172 MB compressed `apt`/FFmpeg layer and a 21.5 MB backend application layer. The Lightsail VPS had
to download about 194 MB of new backend data even though backend behavior did not change.

The workflow already declares `type=gha` cache arguments, but invokes `docker buildx build` from an
inline shell without exposing the GitHub Actions cache runtime credentials. Docker's documented
contract requires those variables for direct CLI use; `docker/build-push-action` supplies them
automatically.

## Goals

- Persist production-image BuildKit caches across trusted release runs.
- Build only production images affected by the merged PR.
- Preserve one immutable release SHA as the operator input.
- Avoid downloading unchanged image layers on the VPS.
- Run backups and migrations only when the backend digest changes.
- Recreate only services required by changed runtime or edge configuration.
- Preserve current, previous, and known-good image-state rollback files.
- Keep production Compose pull-based and keep deployment manual.

## Non-Goals

- No automatic production deployment.
- No new container registry or self-hosted runner.
- No worker-image split or FFmpeg extraction in this change.
- No database, DTO, manifest, environment-secret, or public API changes.
- No change to the release label or semantic-version policy.

## Alternatives Considered

### Build everything with a functioning cache

This would stop most Debian-layer churn but still rebuild, publish, inspect, and deploy unrelated
images. It improves transfer time without correcting the release/deployment coupling.

### Independently version every service

The release could produce three unrelated SHAs and require a manifest or several operator
arguments. This is maximally explicit but expands state, rollback, and operator complexity beyond
what the single-VPS alpha needs.

### Complete release aliases with digest-aware deployment

This is the selected approach. Changed images are built under the new release SHA and version tag.
Unchanged image manifests are copied server-side from the previous version tag to the new release
SHA and version tag. Every release therefore remains a complete bundle addressed by one SHA, while
unchanged services retain the exact previous digest.

## Release Scope Resolution

The release-decision job always collects the complete PR file record set, including previous paths
for renames. A deterministic Node classifier reads current workspace package metadata and expands
changed packages to transitive dependents.

The three runtime targets are:

- `@esl-pipeline/batch-backend`
- `@esl-pipeline/batch-frontend`
- `@esl-pipeline/telegram-ops-bot`

If a target is in the affected package closure, its image is built. Additional rules are:

- `docs/prompt-gallery/**` and `.env.example` affect the backend image.
- Root package-manager and TypeScript build inputs affect all images.
- Deployment scripts, Caddy configuration, workflows, and non-runtime docs affect no application
  image; their previous digests are aliased into the new release bundle.
- Unknown root paths fail closed by building all images.
- Empty or malformed changed-file input fails closed by building all images.

The classifier emits stable booleans and structured reasons for workflow outputs and summaries.

## Cache and Publication Flow

The publish job uses pinned Docker actions:

- `docker/setup-buildx-action`
- `docker/login-action`
- `docker/build-push-action`

Each changed image uses a dedicated `type=gha` cache scope and `mode=max`. The build action owns
GitHub cache credential wiring. Builds remain `linux/amd64`, use `pull: true`, and publish both the
release-commit SHA and `vX.Y.Z` tags.

For every unchanged image, `docker buildx imagetools create` copies the previous version's manifest
to the new SHA and version tags without downloading or rebuilding layers. Failure to resolve the
previous image is fatal; the workflow must never publish an incomplete release bundle.

## Deployment Planning

The VPS command remains:

```bash
bash scripts/deploy/deploy-prod-images.sh <40-character-release-sha>
```

The operator first updates the checkout to that release commit. The script resolves the remote
digest for each requested SHA tag. If a requested digest matches the current state and the current
local image exists, the script tags the local image with the new release SHA instead of pulling its
layers. Otherwise it performs a normal `docker pull` and verifies the resolved digest.

The script also stores a SHA-256 digest of `deploy/caddy/Caddyfile`. Missing digest state from older
deployments is treated as a Caddy change, making the first upgraded deployment backward compatible.

A focused Bash planning library compares current and requested backend, frontend, optional bot, and
Caddy digests. It produces these actions:

| Change                          | Backup/migrate | Recreated services                                |
| ------------------------------- | -------------- | ------------------------------------------------- |
| Backend digest                  | Yes            | backend, all backend workers, frontend, and Caddy |
| Frontend digest                 | No             | frontend and Caddy                                |
| Telegram bot digest             | No             | Telegram bot only, when its profile is enabled    |
| Caddy configuration digest      | No             | Caddy only                                        |
| Release aliases only            | No             | None; update state and run bounded health checks  |
| First deployment/no prior state | Yes            | Full enabled application set and edge             |

Frontend and Caddy restart after a backend change is intentional: nginx and Caddy may retain
upstream resolution across replacement containers.

## State, Failure, and Rollback

State files retain image refs and resolved digests and add `CADDY_CONFIG_DIGEST`. No secrets enter
these files. Before pending state is promoted, current state is copied to previous state, including
for an alias-only release. Pending state is promoted only after required updates and smoke checks
pass.

If remote digest inspection is unavailable, the script safely falls back to `docker pull`. It never
assumes an image is unchanged from tag text alone. If a pulled or locally aliased digest differs
from the registry descriptor, deployment fails before service mutation.

Rollback remains application-only and uses `previous-images.env`. Database restore remains a
separate deliberate operation.

## Verification

- Unit-test package-graph classification, rename/deletion handling, special paths, and fail-closed
  behavior.
- Structure-test pinned Docker actions, per-image cache scopes, changed-image builds, and unchanged
  manifest aliases.
- Execute the Bash deployment planner against backend-only, frontend-only, edge-only, alias-only,
  first-deploy, and optional-bot cases.
- Structure-test that backups/migrations and service recreation consume the planner output.
- Run workflow, shell, Docker, docs, tooling, and broad pre-PR validation.
- Use mocked command boundaries for deployment tests; do not mutate the live VPS during PR work.

## Operator Outcome

After merge, the release still produces one release SHA. The operator updates `/opt/esl-pipeline`
to current `main`, waits for `Release On Merge` to publish the complete SHA-tagged bundle, and runs
the same deploy command. The script prints the detected change plan before mutation so the operator
can see whether backup/migration and each service restart are selected.

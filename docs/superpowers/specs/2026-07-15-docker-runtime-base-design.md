# Docker Runtime Base and Packaging Design

## Meta

- Audience: maintainers and implementation agents.
- Status: approved design.
- Last Verified Against: 2026-07-15 repository Dockerfiles, production Compose, release workflow,
  package manager configuration, and Lightsail runtime constraints.
- Owner: founder-maintainer + automation agents.
- Scope: production application-image bases, Docker build/deploy packaging, controlled infrastructure
  image tags, and image validation.

## Problem

The three production application images build successfully from the current workspace closures, but
their Docker definitions have four avoidable weaknesses:

1. Backend and Telegram application code builds and runs on Alpine Linux. The official Node image
   describes Alpine's `musl` runtime as a compatibility trade-off, and the Node project classifies
   amd64 musl builds as experimental. The backend contains native dependencies and invokes FFmpeg,
   so saving roughly 23 MB of compressed base-image transfer is not worth that runtime boundary.
2. The Dockerfiles prepare pnpm 10 even though the repository pins pnpm 11.10.0. Corepack ultimately
   follows the root `packageManager` declaration, making the pnpm 10 instruction stale and
   misleading.
3. Source changes invalidate the combined install/build/deploy layer. The release workflow already
   exports BuildKit cache, but the Dockerfiles do not use a lockfile-only fetch layer or a pnpm store
   cache mount.
4. Backend and bot use legacy workspace deployment. The backend deployment copies source, tests,
   and repository-only files that are unnecessary at runtime.

The standalone orchestrator Dockerfile is also obsolete. The orchestrator is library-only, its
image is not published or deployed, and the image only imports the built library as a smoke check
after copying the full monorepo.

## Runtime Constraints

Production runs on one AWS Lightsail instance with 2 vCPUs, 2 GB RAM, and a 60 GB SSD. Docker image
bytes primarily consume transfer and disk space, while the independent Node, PostgreSQL, Redis,
FFmpeg, nginx, and Caddy processes determine memory pressure. The selected Debian Node base adds
about 23 MB of compressed shared layers over Alpine. Docker stores that base once and reuses it
across application images and containers, so the disk cost is negligible for this host.

This design does not add speculative memory limits. A later resource-budget task must use production
`docker stats`, host RAM/swap evidence, and worker concurrency before setting Compose limits.

## Goals

1. Run all three production application Dockerfiles' Node build and runtime stages on the current
   stable Debian/glibc family.
2. Keep production images minimal without introducing distroless, custom Node installation, or a
   second application runtime strategy.
3. Make pnpm version selection follow the committed root `packageManager` declaration.
4. Improve rebuild caching with lockfile-first fetch and BuildKit pnpm-store mounts.
5. Replace legacy workspace deployment with pnpm 11's dedicated deploy path and exclude
   repository-only backend files.
6. Keep infrastructure images on their existing official Alpine variants while constraining the
   application/version and Alpine release lines.
7. Preserve every current production command, runtime asset, non-root user, writable path, mount,
   healthcheck, and pull-based deployment contract.
8. Remove the unused orchestrator image surface.

## Non-Goals

- Changing APIs, DTOs, manifests, environment variables, database schemas, or migrations.
- Changing the production service topology or splitting backend workers into separate images.
- Changing development Dockerfiles, local Compose services, or their base images.
- Changing PostgreSQL's libc family or recreating/restoring its data volume.
- Adding Compose CPU or memory limits without production measurements.
- Moving nginx, Caddy, PostgreSQL, or Redis to Debian merely for visual consistency.
- Using distroless, Chainguard/Wolfi, Ubuntu, or a manually installed Node runtime.
- Updating unrelated npm dependencies.
- Building images or running test suites on the Lightsail VPS.
- Deploying to production as part of implementation or PR validation.

## Base Image Policy

### Production application Node stages

Every Node build and runtime stage in the backend, frontend, and Telegram production Dockerfiles
uses:

```text
node:24-trixie-slim
```

The explicit `trixie` name is required. `node:24-slim` currently follows the older Bookworm line,
while Debian 13 Trixie is current stable and supported through June 2030. The tag intentionally
floats Node patch releases within Node 24 and Debian security refreshes within Trixie. Release builds
use `--pull`, so a new eligible release consumes refreshed upstream layers without reviving a custom
pin-update tool.

Build and runtime stages must use the same glibc family. Native dependencies must never be compiled
on Alpine and copied into Debian.

### Official infrastructure images

Production Compose and the frontend runtime use controlled tags:

```text
nginx:1.31-alpine3.23-slim
caddy:2.11-alpine
postgres:18.4-alpine3.24
redis:8.6-alpine3.23
```

These tags preserve the tested official-image variants while allowing patch/security refreshes
inside the selected application and distribution lines. PostgreSQL remains Alpine-based to avoid a
libc/collation migration underneath the existing data volume.

### Rejected alternatives

- `node:24-trixie` includes hundreds of megabytes of general buildpack tooling that the runtime does
  not use.
- `node:24-bookworm-slim` starts a new migration on a Debian release that entered LTS in July 2026.
- Distroless Node lacks normal package and shell tooling. Adding FFmpeg and operational diagnostics
  would require a bespoke runtime assembly, while using it only for the bot would create a second
  application runtime strategy for little benefit.
- Custom Debian/Ubuntu plus a downloaded Node tarball makes this repository responsible for Node
  installation and verification already handled by the official Node image.

## Docker Build Architecture

Each application Dockerfile uses `node:24-trixie-slim` as a shared base pattern, enables Corepack,
and relies on the exact pnpm version in the root `packageManager` field. No Dockerfile names pnpm 10
or another independent pnpm version.

Builder-only Debian packages use one bounded layer:

```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*
```

The frontend builder does not install compiler packages it does not require. Backend runtime
packages remain `ca-certificates`, `curl`, and `ffmpeg`; bot runtime keeps only the certificate
support required for outbound TLS.

Dependency acquisition becomes a lockfile-owned layer:

```dockerfile
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm fetch --frozen-lockfile
COPY packages ./packages
RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm --filter <target>... install --offline --frozen-lockfile
```

Build and deployment remain separate from fetch so source edits can reuse downloaded dependencies.
The mount target deliberately matches the repository's committed `storeDir`; validation must fail
if those paths diverge. The existing GitHub Actions cache remains scoped per image; the BuildKit
store mount improves local and compatible hosted rebuilds without sharing caches with untrusted
builds.

## Workspace Deployment and Runtime Payload

The workspace enables pnpm's documented monorepo deployment mode:

```yaml
injectWorkspacePackages: true
syncInjectedDepsAfterScripts:
  - build
```

The lockfile is regenerated with pnpm 11.10.0 and committed. Docker builds run filtered offline
install, build the full target dependency closure, and then run modern deployment without
`--legacy`:

```text
pnpm --filter @esl-pipeline/batch-backend deploy --prod /app/deployed
pnpm --filter @esl-pipeline/telegram-ops-bot deploy --prod /app/deployed
```

`syncInjectedDepsAfterScripts` ensures injected workspace dependencies receive their freshly built
artifacts before deployment.

The backend package adds this publish/deploy allowlist:

```json
"files": [
  "dist",
  "migrations",
  "schema.sql"
]
```

The runtime image continues to copy `docs/prompt-gallery` separately. Validation must prove that the
runtime still contains compiled API/worker/tool entrypoints, migrations, schema baseline, prompt
assets, FFmpeg, writable `/app/tmp` and `/app/uploads`, and every production dependency. Source,
tests, TypeScript configs, Dockerfiles, and package-local temporary directories must not appear at
the deployed package root.

## Production Image and Compose Contracts

The backend image remains the single coherent runtime for:

- `batch-backend`;
- `batch-worker`;
- `student-memory-worker`;
- `transcribe-worker`.

No worker-specific image is introduced. This preserves package coherence and shared heavy runtime
layers.

The frontend remains rootless nginx on port 8080 and retains its Docker DNS resolver/proxy
configuration. Backend and bot continue to run as the official `node` user. Backend creates and
owns `/app/tmp` and `/app/uploads` before switching users. Existing Compose mounts and commands are
unchanged except for controlled infrastructure image tags.

The release workflow adds `--pull` to the existing three-image `docker buildx build` loop. It still
publishes one SHA-tagged and one version-tagged backend, frontend, and bot bundle only after release
resolution. No image is built on the VPS.

## Orchestrator Image Retirement

Delete `packages/orchestrator/Dockerfile` and the `docker:build` / `docker:run` package scripts. The
orchestrator remains built and tested through its normal package lanes and as part of the backend
dependency closure. Hadolint discovery and its tests must adapt to the smaller tracked-Dockerfile
set without weakening all-Dockerfile discovery.

## Validation Strategy

### Structural tests

A focused Node test reads the Dockerfiles, workspace configuration, package metadata, production
Compose, and release workflow. It locks:

- Debian Trixie slim for every Node stage;
- absence of stale pnpm 10, Alpine Node, and legacy deploy instructions;
- lockfile fetch, offline filtered install, BuildKit cache mounts, modern deploy, and workspace
  injection synchronization;
- controlled nginx/Caddy/PostgreSQL/Redis tags;
- `--pull` in production image publication;
- backend runtime asset allowlist;
- absence of the orchestrator Dockerfile and package scripts.

Existing Hadolint discovery tests continue proving that every remaining tracked Dockerfile is
forwarded to Hadolint.

### Image builds and runtime smoke

Build all three production images locally with `--platform linux/amd64 --pull` so the smoke covers
the same architecture published for the Lightsail host. Validate:

- the configured non-root user and expected command in each image;
- backend Node, bcrypt, FFmpeg, migrations, schema, prompt gallery, writable directories, and all
  four API/worker entrypoint files;
- frontend rootless nginx startup plus `/` and `/api/health` proxy configuration syntax;
- bot entrypoint and production dependency import;
- absence of backend source/tests, pnpm stores/downloads, and builder-only compiler toolchains from
  runtime (the official Node image's bundled Corepack executable is not treated as a removable
  artifact);
- production Compose rendering with placeholder image refs.

Then run Docker lint, the focused structural tests, affected validation, broad pre-PR validation,
and the existing blocking Docker/integration lanes selected by repository routing.

## Documentation and Release

Update the deployment runbook, production environment checklist, and testing guidelines with the
base policy, local/CI image validation, and explicit no-build-on-VPS rule. Do not document transient
image sizes as permanent contracts.

The implementation is one `release:patch` PR. It changes internal packaging and runtime bases
without changing public or persisted contracts. Production deployment remains a separate manual
operator action after merge and successful image publication.

## References

- [Official Node Docker image variants](https://github.com/nodejs/docker-node)
- [Debian 13 lifecycle](https://www.debian.org/releases/trixie/)
- [pnpm Docker guidance](https://pnpm.io/docker)
- [pnpm deploy reference](https://pnpm.io/cli/deploy)
- [Distroless image constraints](https://github.com/GoogleContainerTools/distroless)
- [Official nginx image catalog](https://raw.githubusercontent.com/docker-library/official-images/master/library/nginx)

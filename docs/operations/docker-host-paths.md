# Docker Host Paths

## Meta

- Audience: maintainers and AI agents operating local Docker workflows.
- Authority Level: operations runbook.
- Last Verified Against: 2026-03-17 repo state.
- Owner: ops maintainer + automation agents.
- Review Cadence: monthly or after Docker workflow changes.
- Status: `runbook`.

This repo uses bind mounts for source/runtime data and Docker named volumes for dependency caches.
If host paths are missing, Docker may auto-create them with root ownership and cause `EACCES`.

## Required Local Paths

- `uploads/`
- `uploads/drafts/`

## Dependency Volume Policy (Host vs Docker)

- Host and Docker are intentionally decoupled for dependencies:
  - Host local pnpm commands use repo-local `.npmrc` (`store-dir=.pnpm-store/v10`).
  - Docker dev services use named volumes:
    - `workspace_node_modules` mounted at `/app/node_modules`
    - `workspace_pnpm_store` mounted at `/pnpm` (with `PNPM_STORE_DIR=/pnpm/store`)
  - `deps` bootstraps dependency volume permissions, then hands ownership back to `${UID}:${GID}` for both `/app/node_modules` and package-local `packages/*/node_modules` entries created during install.
- Source code is still bind-mounted at `/app` for live reload.
- This avoids host/container dependency churn while preserving fast Docker restarts.

## Safe Startup Flow

```bash
pnpm docker:prepare
pnpm docker:up
```

`docker:prepare` creates required directories and validates write access.

Optional tooling container (UV + Python) is now profile-gated and off by default:

```bash
docker compose -p esl-pipeline -f docker-compose.yml --profile tools up -d tools
```

## Common Error

If you see:

```text
EACCES: permission denied, mkdir '/app/uploads/drafts'
```

Fix ownership on host, then restart:

```bash
sudo chown -R "$(id -un):$(id -gn)" uploads
pnpm docker:dev:down
pnpm docker:up
```

## Backend Host Port Override

If Docker Desktop reports a port-forward error for `127.0.0.1:8080`, keep the stack
managed by Compose and change only the host-side backend port:

```bash
BATCH_BACKEND_HOST_PORT=8081 pnpm docker:up
```

Frontend still runs on `http://localhost:5173`, and backend becomes
`http://127.0.0.1:8081`.

Nota bene: local desktop apps can silently occupy `8080` (for example,
qBittorrent Web UI). If you see `ports are not available` for `127.0.0.1:8080`,
close that app or move either app to a different host port.

## Recover a Drifted Dev Stack

If a service was started as a one-off container and appears outside the Compose group:

```bash
pnpm docker:dev:recover
```

This command removes stale one-off `batch-backend` containers and restarts the stack
under the canonical project name.

## Reset Docker Dependency Volumes (When Needed)

If Docker dependency state gets corrupted:

```bash
pnpm docker:dev:down
docker volume rm esl-pipeline_workspace_node_modules esl-pipeline_workspace_pnpm_store
pnpm docker:up
```

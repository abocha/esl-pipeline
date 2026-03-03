# Docker Host Paths

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
    - `workspace_pnpm_store` mounted at `/pnpm/store`
- Source code is still bind-mounted at `/app` for live reload.
- This avoids host/container dependency churn while preserving fast Docker restarts.

## Safe Startup Flow

```bash
pnpm docker:prepare
pnpm docker:up
```

`docker:prepare` creates required directories and validates write access.

## Common Error

If you see:

```text
EACCES: permission denied, mkdir '/app/uploads/drafts'
```

Fix ownership on host, then restart:

```bash
sudo chown -R "$(id -un):$(id -gn)" uploads
docker compose down
pnpm docker:up
```

## Reset Docker Dependency Volumes (When Needed)

If Docker dependency state gets corrupted:

```bash
docker compose down --remove-orphans
docker volume rm esl-pipeline_workspace_node_modules esl-pipeline_workspace_pnpm_store
pnpm docker:up
```

Adjust volume names if your compose project name differs.

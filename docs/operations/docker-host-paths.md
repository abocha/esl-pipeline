# Docker Host Paths

This repo uses bind mounts for runtime data and PNPM cache.  
If host paths are missing, Docker may auto-create them with root ownership and cause `EACCES`.

## Required Local Paths

- `uploads/`
- `uploads/drafts/`
- `.pnpm-store/v10/`

## Shared PNPM Store Policy (Host + Docker)

- Repo-local pnpm config (`.npmrc`) sets:

```ini
store-dir=.pnpm-store/v10
```

- Docker services set `NPM_CONFIG_STORE_DIR=/app/.pnpm-store/v10`.
- Because the repo is bind-mounted at `/app`, host and containers share the same physical store.
- Do not set host global pnpm `store-dir` to container-only paths like `/app/...`.

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
sudo chown -R "$(id -un):$(id -gn)" uploads .pnpm-store
docker compose down
pnpm docker:up
```

# Docker Host Paths

## Meta

- Audience: maintainers and AI agents operating local Docker workflows.
- Authority Level: operations runbook.
- Last Verified Against: 2026-08-14 repo state.
- Owner: ops maintainer + automation agents.
- Review Cadence: monthly or after Docker workflow changes.
- Status: `runbook`.

This repo uses bind mounts for source/runtime data and Docker named volumes for dependency caches.
The canonical Compose files set `create_host_path: false` for the upload and production-secret
mounts, so missing paths fail startup instead of being silently created with root ownership.

## Required Local Paths

- `uploads/`
- `uploads/drafts/`

`pnpm docker:prepare` also ensures the default
`packages/orchestrator/configs/elevenlabs.voices.json` catalog. Set
`ESL_TTS_PROVIDER_ELEVENLABS_VOICES_PATH` when a different catalog path is intentionally configured.

## Dependency Volume Policy (Host vs Docker)

- Host and Docker are intentionally decoupled for dependencies:
  - Host local pnpm commands use repo-local `pnpm-workspace.yaml` (`storeDir: .pnpm-store/v11`).
  - Docker dev services use named volumes:
    - `workspace_node_modules` mounted at `/app/node_modules`
    - one `pkg_*_node_modules` volume for each `packages/*/node_modules`
    - `example_orchestrator_service_node_modules` mounted at
      `/app/packages/orchestrator/examples/service/node_modules`
    - `workspace_pnpm_store` mounted at `/pnpm` (with `PNPM_STORE_DIR=/pnpm/store` and
      `NPM_CONFIG_STORE_DIR=/pnpm/store`)
  - `deps` bootstraps dependency volume permissions, then hands ownership back to `${UID}:${GID}` for the Docker-owned dependency volumes.
- Source code is still bind-mounted at `/app` for live reload.
- This avoids host/container dependency churn while preserving fast Docker restarts.

## Adding Workspace Packages

When adding a new `packages/*` workspace package, keep Docker dependency isolation in sync:

1. Add a `pkg_<package_name>_node_modules` named volume in `docker-compose.yml`.
2. Mount it in each dev workspace volume anchor at `/app/packages/<package-name>/node_modules`.
3. Add `/app/packages/<package-name>/node_modules` to each Compose `dependency_paths` bootstrap list.
4. Add the volume key to `scripts/docker/clean-dev-dependency-volumes.mjs` so
   `pnpm docker:dev:clean-deps` can reset it.
5. Run `docker compose -p esl-pipeline -f docker-compose.yml config --quiet` after editing Compose.

The Inworld TTS provider follows this pattern with
`pkg_tts_provider_inworld_node_modules` mounted at
`/app/packages/tts-provider-inworld/node_modules`.

## Safe Startup Flow

```bash
pnpm docker:prepare
pnpm docker:up
```

`docker:prepare` creates required directories and validates write access. It is implemented in
Node.js so the same command works from PowerShell, Linux, and WSL shells.

Run Docker commands from the checkout you want Compose to bind into `/app`. If both a Windows
checkout and a WSL checkout exist, starting Compose from the wrong one will make live reload follow
that other checkout.

Optional tooling container (UV + Python) is now profile-gated and off by default:

```bash
docker compose -p esl-pipeline -f docker-compose.yml --profile tools up -d tools
```

## Production Host Bind Mounts

Production Compose is pull-based and uses the same host upload directory, but it does not build or
create production bind mounts. `pnpm docker:prod` runs `pnpm docker:prepare`, so `uploads/` and
`uploads/drafts/` must exist and remain writable by the production runtime before the services start.
Backend, batch-worker, transcribe-worker, and student-memory-worker mount `./uploads` at
`/app/uploads` as writable storage. Those services also mount `./.secrets` at `/app/secrets` with
`create_host_path: false` and read-only access; create the server-local directory and credentials
outside git as described in [`DEPLOYMENT.md`](../backend-frontend/DEPLOYMENT.md).

`pnpm docker:prod:config` validates the production Compose shape with placeholder image references;
it does not create host paths, build images, or deploy services.

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

On Windows, repair folder permissions through Windows security settings instead of `chown`.

For the broader checkout and host/WSL boundary, see
[`windows-linux-dev.md`](windows-linux-dev.md). For production paths and image/runtime procedures,
see [`DEPLOYMENT.md`](../backend-frontend/DEPLOYMENT.md).

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
pnpm docker:dev:clean-deps
pnpm docker:up
```

The cleanup command removes only the dev dependency volumes for the `esl-pipeline` Compose
project. It does not remove Postgres, Redis, uploads, env files, or host-side `node_modules`.

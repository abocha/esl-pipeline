# Frontend Delivery Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce initial production frontend transfer time through edge compression and correct
cache semantics for content-hashed assets.

**Architecture:** Keep the current Caddy-to-nginx topology. Caddy negotiates response compression;
nginx distinguishes immutable Vite assets from revalidated SPA entry HTML.

**Tech Stack:** Caddy 2.11, nginx 1.31, Node test runner, Docker.

## Global Constraints

- Preserve `browser -> Caddy -> batch-frontend nginx -> /api/* -> batch-backend`.
- Do not change environment, DTO, database, manifest, or deployment-command contracts.
- Do not deploy production from this task.

---

### Task 1: Lock and implement production response delivery

**Files:**

- Modify: `scripts/docker/validate-caddy-config.test.mjs`
- Modify: `scripts/docker/frontend-nginx-config.test.mjs`
- Modify: `deploy/caddy/Caddyfile`
- Modify: `packages/batch-frontend/nginx.conf`
- Modify: `docs/backend-frontend/DEPLOYMENT.md`

**Interfaces:**

- Consumes: Vite's existing content-hashed `/assets/*` output and the current Caddy/nginx topology.
- Produces: negotiated `zstd`/gzip responses, immutable hashed assets, and revalidated SPA HTML.

- [ ] **Step 1: Write failing configuration tests**

  Add assertions that the Caddyfile contains `encode zstd gzip`; nginx has a dedicated `/assets/`
  location with `try_files $uri =404` and the exact immutable cache policy; and `index.html` has the
  exact `no-cache` policy.

- [ ] **Step 2: Verify RED**

  Run:

  ```bash
  node --test scripts/docker/validate-caddy-config.test.mjs scripts/docker/frontend-nginx-config.test.mjs
  ```

  Expected: failures for missing encoding and cache directives while the existing API proxy test
  remains green.

- [ ] **Step 3: Implement the minimal configuration**

  In Caddy:

  ```caddy
  encode zstd gzip
  ```

  In nginx:

  ```nginx
  location ^~ /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
  }

  location = /index.html {
    add_header Cache-Control "no-cache" always;
  }
  ```

  Preserve the current SPA and `/api/*` routing.

- [ ] **Step 4: Verify GREEN and configuration validity**

  Run:

  ```bash
  node --test scripts/docker/validate-caddy-config.test.mjs scripts/docker/frontend-nginx-config.test.mjs
  pnpm docker:caddy:validate
  pnpm docker:lint
  ```

  Expected: all focused tests and configuration validators pass.

- [ ] **Step 5: Build and smoke the production path**

  Build the frontend production image, run it as its declared non-root user, and assert:

  - `/assets/<entry>.js` returns the immutable cache policy.
  - `/index.html` returns `Cache-Control: no-cache`.
  - a missing `/assets/*` path returns 404.
  - a temporary Caddy container in front of nginx returns `Content-Encoding: gzip` for the entry
    JavaScript when requested with `Accept-Encoding: gzip`.

- [ ] **Step 6: Update deployment documentation**

  Record the compression/cache ownership and bounded post-deploy header checks in
  `docs/backend-frontend/DEPLOYMENT.md`.

- [ ] **Step 7: Run final validation and commit**

  Run:

  ```bash
  pnpm format:write
  pnpm format
  pnpm run lint:repo-hygiene
  pnpm docs:check
  pnpm --silent run check:fast:agent
  ```

  Commit with:

  ```bash
  git commit -m "perf(frontend): compress and cache production assets"
  ```

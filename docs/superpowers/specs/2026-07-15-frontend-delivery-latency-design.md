# Frontend Delivery Latency Design

## Status

Approved for implementation on 2026-07-15.

## Problem

The production edge serves hashed frontend JavaScript and CSS without content encoding or an
explicit cache policy. On the current laptop-to-Lightsail route, the 370 KB entry JavaScript takes
multiple seconds to transfer even after the HTTPS connection is established. Repeat navigation is
fast, so the change should optimize initial and post-deployment asset delivery without changing
application behavior.

## Design

The existing topology remains unchanged:

```text
browser -> Caddy -> batch-frontend nginx -> /api/* -> batch-backend
```

- Caddy adds `encode zstd gzip` so compressible frontend and API responses negotiate a supported
  content encoding. Caddy owns this concern because it is the public HTTPS edge.
- nginx gives `/assets/*` responses `Cache-Control: public, max-age=31536000, immutable`. Vite asset
  filenames are content-hashed, so changed content receives a new URL.
- nginx gives `index.html` `Cache-Control: no-cache`. SPA entry HTML must revalidate so a release can
  point the browser at new asset hashes immediately.
- Missing `/assets/*` paths return 404 instead of falling through to the SPA HTML.
- The `/api/*` proxy, ports, image topology, environment surface, and deployment procedure do not
  change.

## Verification

- Source-level tests fail before implementation and lock Caddy encoding plus nginx cache semantics.
- Caddy configuration validation and Docker lint pass.
- A production frontend image serves hashed assets with the immutable policy and `index.html` with
  the revalidation policy.
- A local Caddy/frontend smoke proves gzip negotiation and preserves the same-origin API topology.
- The affected repository validation lane passes.

## Non-Goals

- CDN or DNS-provider migration.
- Lightsail region, bundle, or networking changes.
- Frontend bundle splitting or font self-hosting.
- Backend application or API caching.
- Production deployment from this branch.

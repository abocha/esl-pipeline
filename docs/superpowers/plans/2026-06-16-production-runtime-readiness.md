# Production Runtime Readiness Branch Plan

## Goal

Keep the current readiness branch as one focused production-runtime PR by adding:

- Chunk 3: remove Edge TTS from the backend production runtime image.
- Chunk 9: let the production deploy script reuse Caddy edge env from server-local
  `.env.batch-backend` when shell exports are absent.
- Chunk 10: add a short design note for student-memory throughput and prompt quality; do not
  implement Batch API support in this branch.

## Boundaries

- Do not remove Edge TTS from the orchestrator image, dev backend image, frontend compatibility UI, or
  rerun DTOs in this chunk.
- Keep production TTS providers documented as ElevenLabs, Google, and Inworld.
- Do not commit real `.env.batch-backend` values, production hostnames, provider keys, or VPS state.
- Keep deploy state files image-only; Caddy env fallback may read `.env.batch-backend`, but must not
  copy secrets into `/var/lib/esl-pipeline/deploy/*.env`.
- Chunk 10 is documentation/design only.

## Implementation Steps

1. Add a Dockerfile runtime test proving the production backend image does not install or export Edge
   TTS runtime dependencies.
2. Remove Edge TTS, Python venv, and related env from `packages/batch-backend/Dockerfile` runtime
   stage while preserving ffmpeg and writable `/app/tmp` and `/app/uploads`.
3. Add deploy-script tests for Caddy env fallback from `${APP_DIR}/.env.batch-backend`, with shell
   exports taking precedence.
4. Implement a narrow `.env.batch-backend` parser for `CADDY_PUBLIC_HOSTNAME` and
   `CADDY_ACME_EMAIL`; export the resolved values before Compose uses the edge profile.
5. Update production docs and env examples so Edge TTS is no longer implied as a production backend
   image dependency, and so deploy-script Caddy env source-of-truth is clear.
6. Add a short Chunk 10 design note comparing the current worker path, rate-limit-aware throttling,
   and OpenAI Batch API for backlog student-memory generation.
7. Regenerate docs indexes and run targeted tests plus the affected agent lane.

## Validation

```bash
node --test scripts/docker/backend-dockerfile-runtime.test.mjs
node --test scripts/deploy/deploy-prod-images.test.mjs
pnpm docs:generate:indexes
pnpm docs:check
pnpm --silent run check:fast:agent
git diff --check
```

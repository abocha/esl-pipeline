# syntax=docker/dockerfile:1.7

FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS build

ENV CI=true

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./

# Keep fetched artifacts in the layer cache so a restored fetch layer also restores its store.
RUN pnpm fetch --frozen-lockfile

COPY packages ./packages

# The frozen fetch verifies the workspace lock. Reuse its artifacts for the derived deploy lock
# without requesting registry metadata again (pnpm/pnpm#18063).
RUN --network=none find packages -name '*.tsbuildinfo' -delete \
    && pnpm --filter @esl-pipeline/batch-backend... install --offline --frozen-lockfile \
    && pnpm -r --workspace-concurrency=1 --filter @esl-pipeline/batch-backend... run build \
    && pnpm --store-dir=/app/.pnpm-store/v11 --offline --trust-lockfile --frozen-lockfile --filter @esl-pipeline/batch-backend deploy --prod /app/deployed

FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS runtime

ENV NODE_ENV=production \
    CI=true \
    PIPELINE_CWD=/app \
    FILESYSTEM_UPLOAD_DIR=/app/uploads

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build --chown=node:node /app/deployed/ ./
COPY --chown=node:node packages/batch-backend/prompt-assets ./packages/batch-backend/prompt-assets

RUN mkdir -p /app/tmp /app/tmp/tts-cache /app/uploads \
    && chown -R node:node /app/tmp /app/uploads

EXPOSE 8080

USER node

CMD ["node", "dist/transport/http-server.js"]

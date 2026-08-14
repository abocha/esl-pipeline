# syntax=docker/dockerfile:1.7

FROM node:24-trixie-slim AS build

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
COPY .env.example ./.env.example

RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm fetch --frozen-lockfile

COPY packages ./packages

RUN find packages -name '*.tsbuildinfo' -delete
RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm --filter @esl-pipeline/batch-backend... install --offline --frozen-lockfile
RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm -r --workspace-concurrency=1 --filter @esl-pipeline/batch-backend... run build \
    && pnpm --store-dir=/app/.pnpm-store/v11 --offline --filter @esl-pipeline/batch-backend deploy --prod /app/deployed

FROM node:24-trixie-slim AS runtime

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

# syntax=docker/dockerfile:1.6

FROM node:24-bullseye-slim AS base

ENV PNPM_HOME=/root/.local/share/pnpm \
    PATH="$PNPM_HOME:$PATH" \
    NODE_ENV=production \
    CI=true

RUN corepack enable && corepack prepare pnpm@10 --activate \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY configs ./configs
COPY .env.example ./.env.example
COPY packages ./packages

RUN pnpm install --frozen-lockfile

RUN pnpm -r --filter "./packages/*" build \
 && pnpm --filter @esl-pipeline/orchestrator build

FROM base AS runtime

WORKDIR /app/packages/orchestrator

COPY --from=base /app /app

ENTRYPOINT ["node", "dist/cli.js"]

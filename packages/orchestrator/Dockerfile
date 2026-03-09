# syntax=docker/dockerfile:1.6

FROM node:24-alpine AS build

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="${PNPM_HOME}:${PATH}" \
    NODE_ENV=production \
    CI=true

RUN corepack enable && corepack prepare pnpm@10 --activate \
 && apk add --no-cache \
    ca-certificates \
    python3 \
    make \
    g++

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY .env.example ./.env.example
COPY packages ./packages

RUN pnpm install --frozen-lockfile

RUN pnpm -r --filter "./packages/*" build \
 && pnpm --filter @esl-pipeline/orchestrator build

FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    CI=true

RUN apk add --no-cache \
    ca-certificates \
    ffmpeg

# Keep the full monorepo workspace so batch-backend and others can run.
WORKDIR /app

COPY --from=build /app /app

# Library-only runtime smoke command. Batch-backend is the operational entrypoint.
CMD ["node", "-e", "import('./packages/orchestrator/dist/index.js').then(() => console.log('orchestrator library ready'))"]

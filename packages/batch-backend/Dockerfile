# syntax=docker/dockerfile:1.6

FROM node:24-bullseye-slim AS build

ENV PNPM_HOME=/root/.local/share/pnpm \
    PATH="$PNPM_HOME:$PATH" \
    CI=true

RUN corepack enable && corepack prepare pnpm@10 --activate \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY configs ./configs
COPY .env.example ./.env.example
COPY packages ./packages

RUN find packages -name '*.tsbuildinfo' -delete

RUN pnpm --filter @esl-pipeline/batch-backend... install --frozen-lockfile

RUN pnpm -r --workspace-concurrency=1 --filter @esl-pipeline/batch-backend... run build

RUN pnpm --filter @esl-pipeline/batch-backend deploy --legacy --prod /app/deployed

FROM node:24-bullseye-slim AS runtime

ENV NODE_ENV=production \
    CI=true \
    PIPELINE_CWD=/app \
    FILESYSTEM_UPLOAD_DIR=/app/uploads

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/deployed/ ./
COPY --from=build /app/configs ./configs

EXPOSE 8080

CMD ["node", "dist/transport/http-server.js"]

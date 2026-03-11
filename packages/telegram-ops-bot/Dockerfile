# syntax=docker/dockerfile:1.6

FROM node:24-alpine AS build

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="${PNPM_HOME}:${PATH}" \
    CI=true

RUN corepack enable && corepack prepare pnpm@10 --activate \
    && apk add --no-cache \
        ca-certificates \
        python3 \
        make \
        g++

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages

RUN find packages -name '*.tsbuildinfo' -delete \
    && pnpm --filter @esl-pipeline/telegram-ops-bot... install --frozen-lockfile \
    && pnpm -r --workspace-concurrency=1 --filter @esl-pipeline/telegram-ops-bot... run build \
    && pnpm --filter @esl-pipeline/telegram-ops-bot deploy --legacy --prod /app/deployed

FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    CI=true

RUN apk add --no-cache \
        ca-certificates

WORKDIR /app

COPY --from=build /app/deployed/ ./

CMD ["node", "dist/src/index.js"]

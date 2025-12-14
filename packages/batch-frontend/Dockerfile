# syntax=docker/dockerfile:1.6

FROM node:24-alpine AS build

ENV PNPM_HOME=/root/.local/share/pnpm \
    PATH="$PNPM_HOME:$PATH" \
    CI=true

RUN corepack enable && corepack prepare pnpm@10 --activate \
    && apk add --no-cache ca-certificates

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages

RUN find packages -name '*.tsbuildinfo' -delete

RUN pnpm --filter @esl-pipeline/batch-frontend... install --frozen-lockfile

RUN pnpm -r --workspace-concurrency=1 --filter @esl-pipeline/batch-frontend... run build

FROM nginx:alpine-slim AS runtime

COPY packages/batch-frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/batch-frontend/dist /usr/share/nginx/html

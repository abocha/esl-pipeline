# syntax=docker/dockerfile:1.6

FROM node:24-alpine AS build

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="${PNPM_HOME}:${PATH}" \
    CI=true

RUN corepack enable && corepack prepare pnpm@10 --activate \
    && apk add --no-cache ca-certificates

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages

RUN find packages -name '*.tsbuildinfo' -delete \
    && pnpm --filter @esl-pipeline/batch-frontend... install --frozen-lockfile \
    && pnpm -r --workspace-concurrency=1 --filter @esl-pipeline/batch-frontend... run build

FROM nginx:alpine-slim AS runtime

RUN mkdir -p /tmp/nginx \
    && chown -R nginx:nginx /tmp/nginx /var/cache/nginx /usr/share/nginx/html

COPY packages/batch-frontend/nginx-rootless.conf /etc/nginx/nginx.conf
COPY packages/batch-frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/packages/batch-frontend/dist /usr/share/nginx/html

EXPOSE 8080

USER nginx

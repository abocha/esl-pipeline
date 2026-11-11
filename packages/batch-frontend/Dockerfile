# syntax=docker/dockerfile:1.7

FROM node:24-trixie-slim AS build

ENV CI=true

RUN corepack enable

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./

RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm fetch --frozen-lockfile

COPY packages ./packages

ARG VITE_CALM_STUDIO_V2=true
ENV VITE_CALM_STUDIO_V2=${VITE_CALM_STUDIO_V2}

RUN find packages -name '*.tsbuildinfo' -delete
RUN --mount=type=cache,id=pnpm-store,target=/app/.pnpm-store/v11 \
    pnpm --filter @esl-pipeline/batch-frontend... install --offline --frozen-lockfile
RUN pnpm -r --workspace-concurrency=1 --filter @esl-pipeline/batch-frontend... run build

FROM nginx:1.31.8-alpine3.24-slim AS runtime

RUN mkdir -p /tmp/nginx \
    && chown -R nginx:nginx /tmp/nginx /var/cache/nginx /usr/share/nginx/html

COPY packages/batch-frontend/nginx-rootless.conf /etc/nginx/nginx.conf
COPY packages/batch-frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/packages/batch-frontend/dist /usr/share/nginx/html

EXPOSE 8080

USER nginx

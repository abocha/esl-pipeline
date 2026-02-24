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
COPY .env.example ./.env.example
COPY packages ./packages

RUN find packages -name '*.tsbuildinfo' -delete \
    && pnpm --filter @esl-pipeline/batch-backend... install --frozen-lockfile \
    && pnpm -r --workspace-concurrency=1 --filter @esl-pipeline/batch-backend... run build \
    && pnpm --filter @esl-pipeline/batch-backend deploy --legacy --prod /app/deployed

FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    CI=true \
    PIPELINE_CWD=/app \
    FILESYSTEM_UPLOAD_DIR=/app/uploads

RUN apk add --no-cache \
        ca-certificates \
        ffmpeg

WORKDIR /app

COPY --from=build /app/deployed/ ./

EXPOSE 8080

CMD ["node", "dist/transport/http-server.js"]

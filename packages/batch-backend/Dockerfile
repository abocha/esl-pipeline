# syntax=docker/dockerfile:1.6

ARG EDGE_TTS_VERSION=7.2.8

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

ARG EDGE_TTS_VERSION

ENV EDGE_TTS_VENV=/opt/edge-tts
ENV PATH="${EDGE_TTS_VENV}/bin:${PATH}" \
    ESL_EDGE_TTS_BIN=/opt/edge-tts/bin/edge-tts \
    ESL_EDGE_TTS_PYTHON=/opt/edge-tts/bin/python \
    NODE_ENV=production \
    CI=true \
    PIPELINE_CWD=/app \
    FILESYSTEM_UPLOAD_DIR=/app/uploads

RUN apk add --no-cache \
        bash \
        aws-cli \
        ca-certificates \
        coreutils \
        curl \
        docker-cli \
        docker-cli-compose \
        findutils \
        ffmpeg \
        py3-pip \
        python3 \
    && python3 -m venv "${EDGE_TTS_VENV}" \
    && "${EDGE_TTS_VENV}/bin/pip" install --no-cache-dir "edge-tts==${EDGE_TTS_VERSION}" \
    && chmod -R a+rX "${EDGE_TTS_VENV}"

WORKDIR /app

COPY --from=build /app/deployed/ ./
COPY scripts/docker ./scripts/docker
RUN chmod +x ./scripts/docker/*.sh

EXPOSE 8080

CMD ["node", "dist/transport/http-server.js"]

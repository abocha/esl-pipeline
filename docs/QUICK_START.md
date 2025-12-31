# Quick Start Guide

Get the ESL Pipeline running in 5 minutes.

---

## Prerequisites

- **Node.js 24.10+** (use `nvm use 24` or check `.nvmrc`)
- **pnpm 8+** (`corepack enable`)
- **ffmpeg** on PATH (install via brew/apt/choco)

---

## 1. Install & Configure

```bash
# Clone and install
git clone <repo-url> esl-pipeline
cd esl-pipeline
pnpm install

# Copy and edit environment
cp .env.example .env
# Fill in: NOTION_TOKEN, ELEVENLABS_API_KEY, AWS_* credentials
```

---

## 2. Run the CLI (Interactive Mode)

```bash
pnpm esl --interactive
```

This wizard walks you through:
1. Selecting a student
2. Choosing a Markdown file
3. Configuring TTS and Notion settings
4. Running the full pipeline

---

## 3. Run Non-Interactively

```bash
pnpm esl --md ./lessons/mission.md \
  --preset b1-default \
  --with-tts \
  --upload s3
```

Other commands:
```bash
pnpm esl status --md ./lessons/mission.md   # Check status
pnpm esl rerun --md ./lessons/mission.md    # Rerun steps
pnpm esl --version                           # Version info
```

---

## 4. Run the Batch System (Optional)

For the web-based batch processing interface:

```bash
# Start infrastructure
docker-compose up -d postgres redis

# Start backend
cd packages/batch-backend && pnpm dev

# Start frontend (new terminal)
cd packages/batch-frontend && pnpm dev
```

Open http://localhost:5173 to access the batch interface.

---

## Next Steps

- **Reference docs**: [`docs/reference/`](reference/)
- **Environment variables**: [`docs/reference/env.md`](reference/env.md)
- **Notion features**: [`docs/reference/NOTION_FEATURES.md`](reference/NOTION_FEATURES.md)
- **Batch system**: [`docs/backend-frontend/BATCH_SYSTEM.md`](backend-frontend/BATCH_SYSTEM.md)
- **Full architecture**: [`docs/reference/agents-ssot.md`](reference/agents-ssot.md)

# ESL Pipeline

**From the lesson you just taught to the homework your student actually needs.**

ESL Pipeline is an AI-assisted workspace for independent English tutors. It connects lesson recordings, transcripts, learner history, assignment generation, and publishing in one workflow, without taking pedagogical decisions away from the teacher.

The idea is simple: homework should build on what happened in the lesson, what the learner needs to work on, and what the tutor wants to accomplish next.

Instead of assembling that context across recordings, notes, prompts, and separate tools every time, ESL Pipeline keeps the pieces connected.

## The tutor workflow

The application follows five steps:

1. **Student** — Select a learner and start or resume an assignment.
2. **Lesson source** — Upload a lesson recording for transcription or provide an existing transcript.
3. **Teaching context** — Review the learner's history and specify what the next assignment should focus on.
4. **Create** — Generate and edit a structured homework draft.
5. **Review & share** — Preview the student-facing handout, make final corrections, and publish a shareable version.

The teacher remains responsible for the content. AI generates drafts and helps maintain context; it does not decide what a learner should study or publish assignments without approval.

## Beyond homework generation

ESL Pipeline also brings together several parts of a tutor's everyday work:

- **Learner memory.** Lesson and homework observations contribute to an evolving picture of each student's progress, difficulties, and learning needs.
- **Structured assignments.** Generated homework uses a validated `AssignmentV1` contract rather than relying on loosely formatted model output.
- **Audio-supported materials.** Speech synthesis, voice selection, and pronunciation-related content can be integrated into published assignments.
- **Corrections and recovery.** Assignment versions, background job states, and source provenance remain traceable when work needs to be resumed or corrected.
- **Scheduling and lesson credits.** Student records connect learning activity with lessons, payments, and remaining prepaid sessions.

The aim is not to automate teaching. It is to reduce the administrative work surrounding it, while keeping the tutor informed and in control.

## Under the hood

ESL Pipeline is a TypeScript monorepo with a React/Vite tutor interface, a Fastify API, PostgreSQL for durable state, and Redis/BullMQ for background processing.

The system separates several responsibilities:

| Component                               | Responsibility                                                    |
| --------------------------------------- | ----------------------------------------------------------------- |
| `batch-frontend`                        | Tutor interface, student workspace, and assignment workflow       |
| `batch-backend`                         | API, authentication, durable jobs, learner memory, and generation |
| `contracts`                             | Shared application and structured assignment contracts            |
| `orchestrator`                          | Assignment validation, audio preparation, and publishing pipeline |
| `stt-*` and `tts-*`                     | Speech provider interfaces and integrations                       |
| `html-publisher` and `storage-uploader` | Published materials and their assets                              |

Language-model generation, transcription, and speech synthesis use distinct integration paths. Background work is designed around persistent state, recoverability, and explicit failure handling rather than assuming every provider request succeeds.

For a more detailed map, see the [project overview](docs/PROJECT_OVERVIEW.md) and [batch system guide](docs/backend-frontend/BATCH_SYSTEM.md).

## Running locally

Requirements include Docker, Node.js (the version pinned in [`.nvmrc`](.nvmrc)), and Corepack/pnpm.

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm env:validate -- --profile=development
pnpm docker:up
```

The Docker development stack exposes the tutor frontend at `http://localhost:5173`.

For an isolated product rehearsal without external provider spending, use:

```bash
pnpm smoke:start
```

Follow the [local product smoke guide](docs/operations/local-product-smoke.md) for its setup, limitations, and cleanup.

Additional developer documentation:

- [Quick Start](docs/QUICK_START.md): environment setup and development commands
- [Frontend](packages/batch-frontend/README.md) and [Backend](packages/batch-backend/README.md): application boundaries
- [AssignmentV1](docs/reference/ASSIGNMENT_V1.md): structured assignment format
- [Operations](docs/operations/README.md): maintenance and recovery procedures

## Project status

ESL Pipeline is under active alpha development, currently centered on a single-tutor workflow and intended to grow into a small, privately operated tutor service.

This repository is public to make the engineering work visible. It is **not a publicly available hosted service**, a supported self-hosting distribution, or an open-source collaboration project.

Security concerns can be reported privately through [GitHub Security Advisories](SECURITY.md).

## Copyright

Copyright © 2026 abocha. All rights reserved.

The source code is publicly viewable, but no license to use, modify, or redistribute it is granted.

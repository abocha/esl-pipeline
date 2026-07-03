# Frontend Fast Turnover Testing

## Goal

Make frontend iteration comfortable without rebuilding Docker images or recreating services after
ordinary UI changes, while still preserving a real-auth, real-backend lane for contract and
integration confidence.

## Current Repo Shape

- `packages/batch-frontend` is a Vite React app. `packages/batch-frontend/vite.config.ts` serves on
  port `5173` and proxies `/api` to `BATCH_BACKEND_URL` or `http://localhost:8080`.
- `packages/batch-frontend/src/main.tsx` always wraps the app in `AuthProvider`.
- `packages/batch-frontend/src/context/AuthContext.tsx` hydrates the session through
  `/auth/refresh`, then gates the app on `isAuthenticated`.
- `packages/batch-frontend/src/ui/App.tsx` renders the authenticated app only after auth succeeds.
- Existing frontend component tests already mock `packages/batch-frontend/src/utils/api.ts`,
  especially through `MinimalAssignment.test-harness.tsx` and
  `StudentWorkspace.test-harness.tsx`.
- Backend closed-alpha registration is invite-only through `/auth/register`; the
  `alpha-invites` tool creates a token and `registerInvitedUser` creates the user, workspace,
  membership, default settings, and workspace business settings transactionally.

## Recommended Testing Lanes

### Lane 1: Component and Flow Tests

Use for copy, layout logic, interaction behavior, and most workflow changes.

Commands:

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run <test-file>
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest related --run <source-file>
```

This lane should stay fully mocked, no backend, no database, no Docker.

### Lane 2: Vite Mocked Browser Sandbox

Use for visual and browser-level QA after TSX/CSS changes. This should be the fast inner loop for
work like the assignment builder distillation.

Command:

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend dev -- --host 127.0.0.1 --port 5173
```

Implement a dev-only mode such as:

```bash
VITE_BATCH_FRONTEND_SANDBOX=mock-auth
```

When enabled, and only when `import.meta.env.DEV` is true, the frontend should:

- provide a fake authenticated tutor user;
- install seeded mock API responses for the same endpoints used by the main assignment and student
  workspace flows;
- expose realistic fixture data: at least two students, one profile with structured memory, recent
  assignment sessions, schedule/billing data, prompt options, job options, a recording transcript,
  a prompt package, a generated draft, preview HTML, and a published job status;
- show a small operator-only development marker so screenshots are not confused with production.

The sandbox must fail closed in production builds. No backend auth bypass should be added for this
lane.

### Lane 3: Real Local Backend With Seeded Account

Use when API contracts, auth behavior, backend DTOs, persistence, workspace scoping, or route
fallbacks changed.

Commands:

```bash
corepack pnpm dev:batch
```

or, if only the backend dependencies are already running:

```bash
corepack pnpm --filter @esl-pipeline/batch-backend dev:api
corepack pnpm --filter @esl-pipeline/batch-frontend dev -- --host 127.0.0.1 --port 5173
```

Add an idempotent dev seed command later, for example:

```bash
corepack pnpm --filter @esl-pipeline/batch-backend dev:seed:ui
```

The seed should:

- refuse to run unless `NODE_ENV !== 'production'` and an explicit env flag such as
  `DEV_UI_SEED_ENABLED=true` is present;
- create or update a known local tutor account using real auth tables;
- create the workspace, owner membership, default user settings, and workspace business settings;
- seed one or two students, profiles, schedule/billing records, assignment sessions, lesson/history
  data, and student-memory surfaces needed by the frontend;
- print the local login email and password only for the local dev database.

For this lane, prefer real login over backend auth bypass.

### Lane 4: Docker/Production-Shape Smoke

Use only near PR, release, deployment, or when Docker/Compose/runtime configuration changed.

The Docker dev stack can live-edit source through bind mounts, but ordinary frontend TSX/CSS changes
should not require image rebuilds. Production-style Compose remains a release/deploy concern.

## Implementation Plan

### Step 1: Extract Shared Frontend Fixtures

Create fixture modules under `packages/batch-frontend/src/dev/fixtures/` or
`packages/batch-frontend/src/testing/fixtures/`.

Move reusable seeded payload builders out of test-only harnesses where practical, or duplicate a
small stable fixture set if extracting would make tests noisier.

Keep the fixture data privacy-safe and intentionally fake.

### Step 2: Add Dev-Only Auth Provider Switch

Modify `packages/batch-frontend/src/main.tsx` to choose between:

- normal `AuthProvider`;
- a dev-only `SandboxAuthProvider` when `import.meta.env.DEV &&
import.meta.env.VITE_BATCH_FRONTEND_SANDBOX === 'mock-auth'`.

Add tests proving:

- the normal path remains default;
- the sandbox path only activates under dev + env flag;
- production-like env never enables fake auth.

### Step 3: Add Mock API Adapter For Browser Sandbox

Implement a small browser sandbox adapter for `packages/batch-frontend/src/utils/api.ts` calls.

Preferred shape:

- keep production API functions unchanged;
- when sandbox mode is active, route through a dev-only module that exports the same relevant
  function names and seeded responses;
- cover the main calls used by `MinimalAssignment`, `StudentDirectoryPage`, `StudentAreaShell`,
  `StudentLearningPage`, `StudentHistoryPage`, `StudentScheduleBillingPage`, and business schedule
  pages.

Avoid adding backend bypasses, alternate DTO contracts, or mock-only component branches.

### Step 4: Add A Browser QA Script

Add a lightweight script or documented checklist that starts Vite in sandbox mode and verifies:

- the app reaches the authenticated assignment screen;
- no framework overlay is visible;
- console has no unexpected errors;
- seeded student data appears;
- one assignment flow can reach prompt/draft/preview/publish-ready states without real providers.

Use the Browser plugin or Playwright for evidence, but keep this as an optional local QA lane, not a
mandatory package unit test.

### Step 5: Add Real Backend Seed Command

Add a backend tool after the sandbox is working. It should be idempotent and local-only.

Candidate files:

- `packages/batch-backend/src/tools/dev-seed-ui.ts`
- `packages/batch-backend/package.json`
- `docs/operations/local-ui-testing.md` or `packages/batch-frontend/README.md`

Tests should cover guard behavior and idempotent data creation using the backend DB test harness.

### Step 6: Document The Decision

Document the lane selection in `packages/batch-frontend/README.md` and, if useful, a small operations
doc:

- component test lane for fast logic checks;
- Vite mocked browser sandbox for visual UI iteration;
- real local backend seed lane for contract and auth checks;
- Docker/prod smoke lane for release/deploy shape.

## Validation

For sandbox implementation:

```bash
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/context/AuthContext.test.tsx src/ui/App.test.tsx
corepack pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
corepack pnpm --silent run check:fast:agent
```

For backend seed implementation:

```bash
corepack pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts tests/application.alpha-invites.registration.test.ts
corepack pnpm --silent run check:fast:agent
```

Run `corepack pnpm check:pre-pr` before PR-ready claims if both frontend sandbox and backend seed
work land in the same branch.

## Acceptance Criteria

- A frontend developer can change TSX/CSS, rely on Vite HMR, and inspect seeded authenticated flows
  at `http://localhost:5173` without Docker image rebuilds.
- Mock auth is impossible in production builds.
- Real local auth remains available through seeded login data.
- The sandbox uses realistic API-shaped fixtures, not component-only shortcuts.
- The docs make it obvious which lane to use for each kind of change.

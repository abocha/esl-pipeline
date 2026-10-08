# Local Product Smoke

## Meta

- Audience: maintainers rehearsing cross-layer product changes on a laptop.
- Authority Level: operations runbook.
- Last Verified Against: 2026-10-02 local ESL-11 rehearsal.
- Owner: founder-maintainer + automation agents.
- Review Cadence: after development startup or assignment workflow changes.
- Status: `runbook`.

Use this for changes spanning assignment UI/API persistence, learner context, migrations, prompt
assembly, generation boundaries, or editor/Preview. It supplements focused tests and hosted PR CI;
it is not required for every small change and does not establish production readiness.

## Start and stop

Prerequisites: Docker Desktop with Linux containers (or Linux Docker), Compose, repository-compatible
Node and pinned pnpm, and host dependencies installed with `pnpm install --frozen-lockfile` once.
Keep the existing checkout and pnpm store. Do not copy container or WSL `node_modules` to Windows.

```powershell
pnpm smoke:start
```

Keep that terminal running. Wait for **Smoke READY**, then open <http://127.0.0.1:15173>.
In another terminal:

```powershell
pnpm smoke:status
pnpm smoke:bootstrap-account
```

The helper creates an invitation with the existing `alpha-invites.ts` tool, completes signup
through the normal local `POST /auth/register` route, verifies `POST /auth/login`, then prints a
random local test password once. Open the app and sign in as `smoke@example.test`. This requires
the default `smoke:start` mode and uses only the fixed loopback smoke API and isolated smoke DB; it
does not add or enable an authentication bypass. On later starts without a fresh reset, sign in to
the existing account with the password retained from your local password manager or notes. The
manual `pnpm smoke:invite` flow remains available when you want to exercise browser signup itself.

```powershell
pnpm smoke:stop
pnpm smoke:reset --fresh-state
pnpm smoke:start
pnpm smoke:bootstrap-account
```

`stop` stops host processes and removes smoke containers/network, preserving named volumes and
smoke uploads. Ctrl+C stops host processes and preserves infrastructure too; use `stop` to stop
Docker. Deliberate `reset --fresh-state` also removes **only** the smoke PostgreSQL/Redis volumes
and `tmp/product-smoke/uploads`. It removes synthetic accounts, learners, sessions, prompts, and
queue state. Ordinary dev volumes/uploads and production are outside this boundary. Reset without
the flag fails before touching Docker. Browser session recovery after reset may require signing in
again. Do not point ordinary applications at smoke ports.

## Topology and preparation

| Component             | Execution           | Local address/state                                                |
| --------------------- | ------------------- | ------------------------------------------------------------------ |
| PostgreSQL 18.6       | Docker              | `127.0.0.1:55432`, `esl_smoke`, `esl-pipeline-smoke_postgres_data` |
| Redis 8.10.2 Alpine   | Docker              | `127.0.0.1:56379`, `esl-pipeline-smoke_redis_data`                 |
| API                   | Host pnpm/tsx watch | `http://127.0.0.1:18080`                                           |
| Student-memory worker | Host pnpm/tsx watch | isolated smoke queue/state                                         |
| Frontend              | Host Vite           | `http://127.0.0.1:15173`, proxy to smoke API                       |

The fixed Compose project/file prevents inherited `COMPOSE_PROJECT_NAME` from selecting ordinary
dev state. No source bind mount or Node image build is involved. On this laptop, Node 24.20.0,
pnpm 11.10.0, Docker Desktop 4.93.0, and Compose 5.5.1 worked from `D:\code\esl-pipeline`;
Ubuntu 24.04 WSL2 was available but unnecessary. Host-native Node avoids the costly Windows source
bind-mount path. For the full containerized fallback, a checkout in the WSL Linux filesystem can
reduce bind-mount cost; moving or duplicating this checkout is not required for the hybrid path.

Startup checks host ports, reuses installed dependencies, and builds supporting workspace packages
only when their source/config or root dependency/build inputs change. API and frontend execute their
normal development paths. Startup never installs dependencies. After a dependency change, explicitly
run `pnpm install --frozen-lockfile`. Use `pnpm smoke:prepare` to rebuild dependencies after deleting
build outputs or diagnosing stale injected workspace artifacts. Reload an open browser tab after a
dependency rebuild; it may still hold an older Vite dependency graph.

Fresh PostgreSQL initialization uses the repository `schema.sql` baseline and existing init scripts.
Every start runs `db:migrate` and `prompt-assets:bootstrap` against smoke state before launching host
services. Bootstrap activates missing defaults, imports changed shipped content as a draft, and
preserves existing active revisions. To test freshly shipped prompt defaults from scratch, reset;
to test an existing catalog upgrade, preserve state and use normal prompt administration.

The helper shadows ordinary application `.env` keys and inherited service/provider configuration.
It does not edit `.env`. Storage goes to `tmp/product-smoke/uploads`. The API's existing startup
validation requires STT key fields even for text workflows, so smoke supplies deliberately invalid
placeholders. No transcription, batch publishing, Telegram, or other unrelated worker runs.

## Browser rehearsal

1. Register/login locally. In **Students → Create Student**, create a synthetic learner named
   **Alex** (matching the checked-in AssignmentV1 fixture's `metadata.student`). Expand
   **Starter profile** and add a level, goals, interests, and teacher notes. Check the saved active
   profile in **Learning**; manual edits require no provider.
2. In **Assignments → Start new assignment**, choose that learner and continue.
3. Choose **Use an existing transcript**, paste the synthetic text below, and select **Use
   transcript**. Confirm the saved transcript and continue.
4. Add teacher notes in **Teaching context**. The student-memory worker runs the normal initial
   enrichment path. In default no-spend mode, provider enrichment fails/blocks deliberately; wait
   for the UI to allow continuing with available manual context. Check **All changes saved**, then
   confirm and continue.
5. Create a **fresh prompt package** from the current confirmed source/context. Inspect the pinned
   learner revision and prompt. Reload/resume the session to verify saved context and source.
6. Select **Generate assignment** (the Generate Draft action). It creates a fresh prompt package
   before generation. Default mode must stop at the provider boundary with an unavailable-provider
   result. This is a successful no-spend boundary, not successful generation.
7. After the expected provider-unavailable result, use the manual **Assignment JSON** editor
   to exercise validated draft autosave and **Preview** with the existing repository fixture below.
   A provider failure is not a successful generation; if the current UI does not allow manually
   creating or saving a typed draft at this boundary, record the blocker instead of claiming a
   successful Preview. Publishing/audio is outside this rehearsal.

```text
Teacher: What did you do last weekend?
Learner: I cooked soup and walked in the park.
Teacher: Who did you cook with?
Learner: I cooked with my sister. Next weekend I want to visit a museum.
Teacher: Practise past simple questions and talking about future plans.
```

If Context says **Saving needs attention / Invalid request** on a checkout preceding ESL-10,
apply/merge the existing recovery fix in [PR #320](https://github.com/abocha/esl-pipeline/pull/320)
before rehearsing further. ESL-11's local rehearsal uses that commit as a separate dependency.

For the typed-editor check, copy the **existing read-compatible AssignmentV1 JSON fixture** used
by the frontend sandbox (not the legacy Markdown fixture, and not a fresh-generation v8 example):

```powershell
Get-Content -Raw packages/batch-frontend/src/dev/assignment-fixture.json | Set-Clipboard
```

With **Alex** as the selected learner and **Use an existing transcript** as the source path, paste
it into **Assignment JSON**. This fixture has `metadata.student: "Alex"`, `input.kind: "generate"`
and no external URLs; its metadata and source kind must match the session validation context.
Wait for a valid autosave, then continue to **Review & share** and open **Preview assignment**.
An invalid JSON buffer is browser-local and cannot be saved or previewed. The old
`scripts/smoke/product-assignment.md` is Markdown with YAML frontmatter and must **not** be pasted
into the new AssignmentV1 editor. This check exercises the read-compatible manual edit/Preview
path; it does not prove that current v8 generation or a provider call succeeded.

## Deliberate real generation

Default startup removes live provider credentials. It keeps a one-request configured OpenAI daily
budget so the Create action can assemble a fresh prompt package; the provider adapter rejects the
missing key before any network request. Other providers have zero daily request limits.
It never copies provider credentials from ordinary `.env`, even when they are available there.
For a generation-boundary change that needs real provider evidence, stop smoke, then in PowerShell:

```powershell
$env:SMOKE_OPENAI_API_KEY = Read-Host 'Local OpenAI API key' -MaskInput
pnpm smoke:start --live
```

Use an already-prepared session/manual learner context and click Generate Draft once. Live mode
starts API/frontend only, leaving the student-memory worker stopped so queued enrichment cannot
spend the key. It uses the normal assignment provider/model contract, configured quota mode, a
one-request daily budget, and zero retries. This is an operator-controlled foreground test, not a
global provider billing cap; verify retained budget state and do not reset merely to bypass a limit.
Remove the shell key afterward with `Remove-Item Env:SMOKE_OPENAI_API_KEY`, stop, and restart normally.
No live provider call was performed for ESL-11.

## Full development fallback

Keep the existing full stack for container/runtime fidelity or Docker-specific diagnosis:
[`windows-linux-dev.md`](windows-linux-dev.md) and
[`DEPLOYMENT.md`](../backend-frontend/DEPLOYMENT.md) describe `pnpm docker:up` and recovery.
It uses ordinary dev state and configuration, not this workflow's no-spend shield. Stop smoke before
switching and explicitly inspect provider credentials. Development Redis is refreshed to the same
official 8.10.2 Alpine tag; production Redis is unchanged.

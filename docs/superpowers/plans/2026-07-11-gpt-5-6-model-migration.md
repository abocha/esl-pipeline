# GPT-5.6 Model Family Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route assignments to `gpt-5.6-sol` and every other active OpenAI generation workload to `gpt-5.6-luna` with workload-calibrated reasoning effort.

**Architecture:** Keep the existing Responses API and versioned generation envelope. Collapse built-in OpenAI configuration defaults and allowlists to two GPT-5.6 models, encode effort by envelope workload, align offline fixtures and active documentation, and preserve environment overrides and the compatibility gate.

**Tech Stack:** TypeScript, Vitest, pnpm, OpenAI Responses API, Markdown documentation.

## Global Constraints

- Assignment draft uses `gpt-5.6-sol` with `medium` reasoning and `medium` verbosity.
- Profile revision and student-memory snapshot use `gpt-5.6-luna` with `medium` reasoning and `low` verbosity.
- Lesson memory, homework memory, and profile candidate patch use `gpt-5.6-luna` with `low` reasoning and `low` verbosity.
- Do not add Pro mode, persisted reasoning, tools, explicit caching, Programmatic Tool Calling, multi-agent execution, or a new request schema.
- Preserve explicit environment overrides, provider ordering, quotas, retries, schemas, evidence validation, batch gates, and non-OpenAI providers.
- Change prompts only for a concrete duplication, contradiction, missing success criterion, or observed eval failure.
- Perform at most one paid live eval, only after all offline and repository checks pass; stop before push or PR if it fails.

---

### Task 1: Lock GPT-5.6 Runtime Policy with Failing Tests

**Files:**

- Modify: `packages/batch-backend/tests/config.env.test.ts`
- Modify: `packages/batch-backend/tests/application.generation-request-envelope.test.ts`
- Modify: `packages/batch-backend/src/config/env.ts`
- Modify: `packages/batch-backend/src/application/generation-request-envelope.ts`

**Interfaces:**

- Consumes: `loadConfig()` and `createGenerationRequestEnvelope()`.
- Produces: two-model OpenAI defaults and the approved `reasoningEffort` mapping.

- [ ] **Step 1: Write failing config and envelope assertions**

Replace legacy default expectations with assertions that both target-gate states expose assignment/default primary `gpt-5.6-sol`, every fallback/memory/profile slot `gpt-5.6-luna`, and an allowlist equal to `['gpt-5.6-sol', 'gpt-5.6-luna']`. Add snapshot and assignment envelope assertions:

```ts
expect(snapshot.settings).toEqual({ reasoningEffort: 'medium', textVerbosity: 'low' });
expect(assignment.settings).toEqual({ reasoningEffort: 'medium', textVerbosity: 'medium' });
```

- [ ] **Step 2: Verify the tests fail for legacy defaults**

Run:

```powershell
./node_modules/.bin/vitest.CMD run --config vitest.config.ts packages/batch-backend/tests/config.env.test.ts packages/batch-backend/tests/application.generation-request-envelope.test.ts
```

Expected: FAIL showing legacy `gpt-5.5`/`gpt-5.4*` defaults and snapshot `low` effort.

- [ ] **Step 3: Implement the two-model defaults and effort policy**

Set configuration fallbacks so primary is `gpt-5.6-sol`, every other built-in slot is `gpt-5.6-luna`, and the derived allowlist contains those two distinct values. Change only `student_memory_snapshot` to `medium`; keep the other approved envelope settings unchanged.

- [ ] **Step 4: Verify focused tests pass**

Run the Step 2 command again. Expected: both files PASS.

- [ ] **Step 5: Commit runtime policy**

```powershell
git add packages/batch-backend/src/config/env.ts packages/batch-backend/src/application/generation-request-envelope.ts packages/batch-backend/tests/config.env.test.ts packages/batch-backend/tests/application.generation-request-envelope.test.ts
git commit -m "feat(generation): migrate OpenAI workloads to GPT-5.6"
```

### Task 2: Align Offline Evaluation Fixtures and Prompt Contract

**Files:**

- Modify: `packages/batch-backend/tests/application.generation-evaluator.test.ts`
- Modify: `packages/batch-backend/src/application/generation-eval-fixtures.ts`
- Inspect: `docs/prompt-gallery/templates/hw_prompt_definitive.md`
- Inspect: `packages/batch-backend/src/application/lesson-memory-prompt.ts`
- Inspect: `packages/batch-backend/src/application/homework-memory-prompt.ts`
- Inspect: `packages/batch-backend/src/application/student-memory-snapshot-prompt.ts`
- Inspect: `packages/batch-backend/src/application/profile-draft-refresh.ts`
- Inspect: `packages/batch-backend/src/application/profile-candidate-promotion.ts`

**Interfaces:**

- Consumes: `GENERATION_EVAL_FIXTURES` and the existing envelope/schema builders.
- Produces: representative offline fixtures on the same model mapping as runtime.

- [ ] **Step 1: Write failing fixture-model assertions**

Update evaluator expectations so `assignment-v1` requests `gpt-5.6-sol` and all five non-assignment fixtures request `gpt-5.6-luna`.

- [ ] **Step 2: Verify fixture tests fail**

Run:

```powershell
./node_modules/.bin/vitest.CMD run --config vitest.config.ts packages/batch-backend/tests/application.generation-evaluator.test.ts
```

Expected: FAIL where fixtures still provide GPT-5.5/GPT-5.4 model IDs.

- [ ] **Step 3: Update fixture model IDs and audit prompts**

Change only fixture `model` values. Inspect each listed prompt against the GPT-5.6 outcome-first, evidence, output-contract, and stop-condition guidance. Leave working prompt text unchanged unless a concrete contradiction or duplicated instruction is present; if one is found, add a focused failing prompt assertion before the minimal prompt edit.

- [ ] **Step 4: Verify evaluator and request-contract tests pass**

Run:

```powershell
./node_modules/.bin/vitest.CMD run --config vitest.config.ts packages/batch-backend/tests/application.generation-evaluator.test.ts packages/batch-backend/tests/application.generation-request-envelope.test.ts packages/batch-backend/tests/application.generation-providers.structured-output.test.ts packages/batch-backend/tests/application.openai-responses-contract.test.ts
```

Expected: all selected files PASS.

- [ ] **Step 5: Run the offline generation evaluation**

```powershell
pnpm --filter @esl-pipeline/batch-backend generation:eval
```

Expected: exit 0 with every fixture schema-valid and evidence/quality checks passing.

- [ ] **Step 6: Commit fixtures and any evidence-backed prompt edit**

```powershell
git add packages/batch-backend/src/application/generation-eval-fixtures.ts packages/batch-backend/tests/application.generation-evaluator.test.ts
git commit -m "test(generation): align evals with GPT-5.6 routing"
```

Include any prompt and its focused test in the same commit only if Step 3 found a concrete defect.

### Task 3: Align Active Documentation and Validate the Branch

**Files:**

- Modify: `.env.example`
- Modify: `packages/batch-backend/README.md`
- Modify: `docs/reference/GENERATION_PROVIDER_POLICY.md`
- Modify: `docs/reference/env.md`
- Modify: `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`
- Modify: generated documentation indexes only through the repository generator.

**Interfaces:**

- Consumes: the runtime policy from Tasks 1-2.
- Produces: active operator and maintainer guidance matching runtime behavior.

- [ ] **Step 1: Update active model and gate documentation**

Document the Sol/Luna mapping and effort matrix, explain that both compatibility-gate states now use GPT-5.6 built-ins while explicit environment overrides remain honored, and link the current GPT-5.6 model/prompt guidance. Do not rewrite historical GPT-5.4/GPT-5.5 guidance files.

- [ ] **Step 2: Verify no active built-in legacy defaults remain**

```powershell
rg -n "gpt-5\.5|gpt-5\.4(-mini|-nano)?" packages/batch-backend/src packages/batch-backend/README.md .env.example docs/reference/GENERATION_PROVIDER_POLICY.md docs/reference/env.md docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md
```

Expected: no active-default matches; explanatory migration history or explicit override examples must be reviewed individually.

- [ ] **Step 3: Generate and check documentation**

```powershell
pnpm docs:generate:indexes
pnpm docs:check
```

Expected: both commands exit 0.

- [ ] **Step 4: Run affected and broad validation**

```powershell
pnpm --silent run check:fast:agent
pnpm check:pre-pr
```

Expected: both commands exit 0; on failure, inspect the reported `tmp/check-logs` artifact and stop if the issue cannot be corrected within scope.

- [ ] **Step 5: Commit documentation and generated indexes**

```powershell
git add .env.example packages/batch-backend/README.md docs/reference/GENERATION_PROVIDER_POLICY.md docs/reference/env.md docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md docs/generated
git commit -m "docs(generation): document GPT-5.6 workload policy"
```

### Task 4: One Paid Live Evaluation and PR Publication

**Files:**

- Read: retained live-evaluation report under `tmp/` as printed by the command.
- Modify: `.github/pull_request_template.md` only as a temporary PR body file if the repository workflow requires filling it in; do not commit unrelated template edits.

**Interfaces:**

- Consumes: a fully passing branch and configured `OPENAI_API_KEY`/live-eval authorization.
- Produces: one reviewed live report and, only on success, a pushed branch and ready PR with exactly one release label.

- [ ] **Step 1: Confirm the worktree is clean and all prerequisite evidence is current**

```powershell
git status --short
git log --oneline -4
```

Expected: no uncommitted implementation files and commits for design, runtime, eval, and docs.

- [ ] **Step 2: Run exactly one paid live evaluation**

```powershell
$env:GENERATION_LIVE_EVAL_ENABLED='true'; pnpm --filter @esl-pipeline/batch-backend generation:eval:live
```

Expected: exit 0 and a retained report showing every workload passed schema validity, grounding/evidence checks, assignment quality, and provider completion. Do not rerun on failure.

- [ ] **Step 3: Stop on any live-eval failure**

If the command exits nonzero or any report dimension fails, do not push and do not create a PR. Report requested/returned models, schema validity, grounding coverage, assignment quality, token use, latency, and provider errors from the single report.

- [ ] **Step 4: Push and create the PR only after live success**

Determine the release label from `docs/reference/VERSIONING_MODEL.md` (expected `release:minor` for a backward-compatible model-policy surface expansion), push the branch, create a ready PR using the exact template sections, and verify exactly one release label:

```powershell
git push -u origin codex/gpt-5-6-model-migration
gh pr create --base main --head codex/gpt-5-6-model-migration --title "feat(generation): migrate OpenAI workloads to GPT-5.6" --body-file .github/pull_request_template.md --label release:minor
gh pr view --json url,labels
```

Expected: push succeeds, PR is created, and labels contain exactly `release:minor`.

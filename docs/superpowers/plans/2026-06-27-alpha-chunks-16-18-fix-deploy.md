# Alpha Chunks 16-18 Fix And Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three P1 alpha-readiness issues around rerun page theming, profile draft revision generation, and student-name grounding in assignment prompts, then ship the reviewed result through the normal PR and production deploy path.

**Architecture:** Keep each fix at the boundary that currently drops or misroutes data. Rerun theme preservation belongs in the rerun DTO/worker/orchestrator publish path, profile draft generation belongs in a full-profile drafting path separate from candidate-patch safety promotion, and assignment student-name grounding belongs in prompt-package construction before provider execution.

**Tech Stack:** TypeScript, pnpm, Vitest, React, Fastify routes, `@esl-pipeline/batch-backend`, `@esl-pipeline/batch-frontend`, `@esl-pipeline/orchestrator`, `@esl-pipeline/html-publisher`, GitHub Actions, GHCR release images, Lightsail deployment script.

---

## Operating Constraints

- Start from `D:\code\esl-pipeline`.
- Re-read `AGENTS.md`, `docs/reference/agents-ssot.md`, and `docs/plans/2026-06-23-alpha-readiness.md` before implementation if context has compacted.
- Preserve the intentional existing doc changes in:
  - `docs/backend-frontend/DEPLOYMENT.md`
  - `docs/plans/2026-06-23-alpha-readiness.md`
- Work on one short-lived branch, for example:

```powershell
git switch -c codex/alpha-chunks-16-18-fixes
```

- Do not change production feature flags as part of implementation. Production deployment requires separate maintainer approval per the alpha-readiness operating boundaries.
- Expected PR release label: `release:patch`, unless implementation unexpectedly changes public DTO or contract-version surfaces.

## File Map

- Modify: `packages/orchestrator/src/types.ts`
  - Add `preset?: string` to `RerunFlags` so reruns can receive the persisted color preset.
- Modify: `packages/orchestrator/src/index.ts`
  - In `rerunAssignment`, resolve heading theme from `flags.preset ?? manifest.preset`.
  - Persist the effective preset in the updated manifest when available.
- Modify: `packages/orchestrator/tests/rerun-publish-student-name.test.ts`
  - Extend or add a neighboring rerun publish regression that proves rerun HTML keeps the `b1-default` yellow H2 theme when the rerun request supplies a preset.
- Modify: `packages/batch-backend/src/infrastructure/pipeline-worker-entry.ts`
  - Pass `payload.preset` into `RerunFlags`.
- Modify: `packages/batch-backend/tests/infrastructure.pipeline-worker-entry.test.ts`
  - Assert rerun worker invocations forward the persisted job preset.
- Modify: `packages/batch-backend/src/application/profile-candidate-promotion.ts`
  - Keep candidate promotion as a closed `profile_candidate_patch_v1` path.
  - Rename prompt/envelope helpers only if useful for clarity; do not convert this path into full draft generation.
- Create: `packages/batch-backend/src/application/profile-draft-refresh.ts`
  - New full-draft profile revision generation path for the tutor-facing "generate draft revision" action.
- Modify: `packages/batch-backend/src/transport/extended-routes/students-routes.ts`
  - Add a route such as `POST /students/:id/profile-drafts/refresh-from-approved-candidates` for full draft refresh.
  - Keep `POST /students/:id/profile-candidates/promote` for explicit safety promotion.
- Modify: `packages/batch-backend/tests/application.profile-candidate-promotion.test.ts`
  - Assert candidate promotion still sends `profile_candidate_patch_v1`.
- Create: `packages/batch-backend/tests/application.profile-draft-refresh.test.ts`
  - Assert draft refresh sends a full `foundational_profile_v1` prompt/envelope and saves a structured draft revision.
- Modify: `packages/batch-backend/tests/transport.http-server.integration.students-content.test.ts`
  - Cover the new route and keep the old promotion route behavior intact.
- Modify: `packages/batch-frontend/src/utils/api.ts`
  - Add a frontend API helper for the new draft-refresh route.
- Modify: `packages/batch-frontend/src/ui/students/StudentLearningPage.tsx`
  - Route the "Generate Draft Revision" action to the new full draft-refresh API helper.
- Modify: `packages/batch-frontend/src/ui/students/WorkspaceCandidatesPanel.tsx`
  - If needed, rename visible copy to clarify full draft refresh versus candidate safety promotion.
- Modify: `packages/batch-frontend/src/ui/students/StudentLearningPage.test.tsx`
  - Assert the button calls the new API helper and no longer calls `promoteStudentProfileCandidates`.
- Modify: `packages/batch-frontend/src/ui/students/StudentWorkspace.candidates.test.tsx`
  - Update component-level callback names only if frontend prop names change.
- Modify: `packages/batch-backend/src/application/create-prompt-package.ts`
  - Resolve the selected student's canonical display name and pass it to prompt assembly.
- Modify: `packages/batch-backend/src/application/prompt-assembly.ts`
  - Add a `CANONICAL_STUDENT_NAME` source block and an instruction that assignment headers and student-facing copy must use this name instead of transcript inference.
- Modify: `packages/batch-backend/tests/application.prompt-package.resolution.test.ts`
  - Assert prompt package text and request envelope include the canonical student name when `recording.studentId` is present.
- Modify: `packages/batch-backend/tests/application.prompt-package.test-harness.ts`
  - Update stubs if the inserted prompt package shape or request envelope assertions need the new source.
- Optional docs update: `docs/plans/2026-06-23-alpha-readiness.md`
  - Mark chunks as completed only after implementation, validation, PR merge, and deployment evidence.
- Optional docs update: `docs/operations/hosted-mvp-evidence.md`
  - Record deployed SHA and smoke evidence after production deploy.

---

### Task 1: Baseline Reproduction And Branch Hygiene

**Files:**
- Read: `AGENTS.md`
- Read: `docs/reference/agents-ssot.md`
- Read: `docs/plans/2026-06-23-alpha-readiness.md`
- Read: `docs/backend-frontend/DEPLOYMENT.md`

- [ ] **Step 1: Confirm dirty worktree and branch**

Run:

```powershell
git status --short
git branch --show-current
```

Expected: only the known intentional doc changes are dirty before implementation:

```text
 M docs/backend-frontend/DEPLOYMENT.md
 M docs/plans/2026-06-23-alpha-readiness.md
```

- [ ] **Step 2: Create the implementation branch**

Run:

```powershell
git switch -c codex/alpha-chunks-16-18-fixes
```

Expected: branch created and worktree still contains the intentional docs.

- [ ] **Step 3: Run the focused currently-passing tests around likely surfaces**

Run:

```powershell
pnpm --filter @esl-pipeline/orchestrator vitest run tests/rerun-publish-student-name.test.ts
pnpm --filter @esl-pipeline/batch-backend vitest run tests/application.profile-candidate-promotion.test.ts tests/application.prompt-package.resolution.test.ts
pnpm --filter @esl-pipeline/batch-frontend vitest run src/ui/students/StudentLearningPage.test.tsx
```

Expected: tests pass before new failing assertions are added. If any fail, read the failure and fix the test environment before changing behavior.

---

### Task 2: Chunk 16 Failing Tests For Rerun Theme Preservation

**Files:**
- Modify: `packages/orchestrator/tests/rerun-publish-student-name.test.ts`
- Modify: `packages/batch-backend/tests/infrastructure.pipeline-worker-entry.test.ts`

- [ ] **Step 1: Add orchestrator regression for preset-driven yellow theme on rerun**

In `packages/orchestrator/tests/rerun-publish-student-name.test.ts`, add this test beside the existing rerun publish test:

```ts
it('preserves the normal yellow heading theme when a rerun receives the persisted preset', async () => {
  publishedHtml.length = 0;

  const { manifestPathFor, rerunAssignment } = await import('../src/index.js');
  const dir = await mkdtemp(join(tmpdir(), 'orchestrator-rerun-theme-'));
  const mdPath = join(dir, 'lesson.md');
  const audioPath = join(dir, 'study.mp3');
  await writeFile(audioPath, 'audio');
  await writeFile(
    mdPath,
    [
      '---',
      'title: "Homework Assignment"',
      'student: "Alice Nguyen"',
      'topic: "Travel"',
      '---',
      '',
      '# Homework Assignment',
      '',
      '## A. Warm-Up',
      'Read and answer.',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    manifestPathFor(mdPath),
    JSON.stringify(
      {
        schemaVersion: 3,
        mdHash: 'original-hash',
        publishTarget: 'html',
        audioArtifacts: {
          studyText: {
            path: audioPath,
            url: 'https://example.com/study.mp3',
            hash: 'a'.repeat(64),
          },
        },
        timestamp: '2026-06-27T00:00:00.000Z',
      },
      null,
      2,
    ),
    'utf8',
  );

  await rerunAssignment({
    md: mdPath,
    manifestMd: mdPath,
    preset: 'b1-default',
    republishOnly: true,
    upload: 's3',
  });

  expect(publishedHtml).toHaveLength(1);
  expect(publishedHtml[0]).toContain('--theme-h2: #fdecc8;');
  expect(publishedHtml[0]).toContain('--theme-h3: #e7dbe9;');
});
```

- [ ] **Step 2: Add backend worker regression for rerun preset forwarding**

In `packages/batch-backend/tests/infrastructure.pipeline-worker-entry.test.ts`, update the existing rerun worker test or add a new one so the mocked orchestrator receives:

```ts
expect(executeRerunAssignmentV2).toHaveBeenCalledWith(
  expect.objectContaining({
    assignment: expect.objectContaining({
      preset: 'b1-default',
    }),
  }),
  expect.anything(),
);
```

- [ ] **Step 3: Run tests to verify red**

Run:

```powershell
pnpm --filter @esl-pipeline/orchestrator vitest run tests/rerun-publish-student-name.test.ts
pnpm --filter @esl-pipeline/batch-backend vitest run tests/infrastructure.pipeline-worker-entry.test.ts
```

Expected: both new assertions fail because `RerunFlags` has no `preset` and the backend worker drops `payload.preset`.

---

### Task 3: Chunk 16 Minimal Implementation

**Files:**
- Modify: `packages/orchestrator/src/types.ts`
- Modify: `packages/orchestrator/src/index.ts`
- Modify: `packages/batch-backend/src/infrastructure/pipeline-worker-entry.ts`

- [ ] **Step 1: Add `preset` to rerun flags**

In `packages/orchestrator/src/types.ts`, change `RerunFlags` to include:

```ts
export interface RerunFlags {
  md: string;
  manifestMd?: string;
  preset?: string;
  voices?: string;
  out?: string;
  dryRun?: boolean;
  upload?: 's3';
  // existing fields remain unchanged
}
```

- [ ] **Step 2: Prefer explicit rerun preset when publishing HTML**

In `packages/orchestrator/src/index.ts`, inside the `rerunAssignment` `add-audio` publish branch, replace:

```ts
if (manifest.preset) {
  headingTheme = await loadHeadingThemeForPreset(manifest.preset, DEFAULT_PRESETS_PATH);
}
```

with:

```ts
const effectivePreset = flags.preset ?? manifest.preset;
if (effectivePreset) {
  headingTheme = await loadHeadingThemeForPreset(effectivePreset, DEFAULT_PRESETS_PATH);
}
```

When `updatedManifest` is built, preserve the effective preset:

```ts
preset: effectivePreset ?? manifest.preset,
```

If `updatedManifest` is not near the publish branch, define `const effectivePreset = flags.preset ?? manifest.preset;` once near manifest loading and reuse it.

- [ ] **Step 3: Forward persisted job preset through the worker**

In `packages/batch-backend/src/infrastructure/pipeline-worker-entry.ts`, add this field to `runRerunPipeline` flags:

```ts
preset: payload.preset,
```

- [ ] **Step 4: Run Chunk 16 tests**

Run:

```powershell
pnpm --filter @esl-pipeline/orchestrator vitest run tests/rerun-publish-student-name.test.ts
pnpm --filter @esl-pipeline/batch-backend vitest run tests/infrastructure.pipeline-worker-entry.test.ts
```

Expected: tests pass and rerun HTML contains the `b1-default` yellow H2 and purple H3 theme values.

- [ ] **Step 5: Commit Chunk 16**

Run:

```powershell
git add packages/orchestrator/src/types.ts packages/orchestrator/src/index.ts packages/orchestrator/tests/rerun-publish-student-name.test.ts packages/batch-backend/src/infrastructure/pipeline-worker-entry.ts packages/batch-backend/tests/infrastructure.pipeline-worker-entry.test.ts
git commit -m "fix(orchestrator): preserve rerun html theme preset"
```

---

### Task 4: Chunk 17 Failing Tests For Full Draft Refresh Routing

**Files:**
- Modify: `packages/batch-backend/tests/application.profile-candidate-promotion.test.ts`
- Create: `packages/batch-backend/tests/application.profile-draft-refresh.test.ts`
- Modify: `packages/batch-frontend/src/ui/students/StudentLearningPage.test.tsx`

- [ ] **Step 1: Strengthen candidate promotion safety regression**

In `packages/batch-backend/tests/application.profile-candidate-promotion.test.ts`, extend the existing successful promotion test:

```ts
expect(generate).toHaveBeenCalledWith(
  expect.objectContaining({
    request: expect.objectContaining({
      operation: 'candidate_promotion',
      responseSchema: expect.objectContaining({
        name: 'profile_candidate_patch_v1',
        strict: true,
      }),
    }),
  }),
);
```

- [ ] **Step 2: Add new full draft refresh application test**

Create `packages/batch-backend/tests/application.profile-draft-refresh.test.ts` with a test that calls the new service and asserts:

```ts
expect(generate).toHaveBeenCalledWith(
  expect.objectContaining({
    request: expect.objectContaining({
      operation: 'profile_revision_refresh',
      responseSchema: expect.objectContaining({
        name: 'foundational_profile_v1',
        strict: true,
      }),
      envelope: expect.objectContaining({
        workload: 'profile_revision',
        sources: expect.arrayContaining([
          expect.objectContaining({ label: 'STUDENT_NAME', content: 'Tolik' }),
          expect.objectContaining({ label: 'BASE_STRUCTURED_PROFILE' }),
          expect.objectContaining({ label: 'APPROVED_PROFILE_CANDIDATES' }),
        ]),
      }),
    }),
  }),
);
expect(saveRevision).toHaveBeenCalledWith(
  'profiles/students/tolik.md',
  expect.stringContaining('# Foundational Profile'),
  expect.objectContaining({
    source: 'profile_revision_refresh',
    status: 'draft',
    structuredContent: expect.objectContaining({
      schemaVersion: 'foundational_profile_v1',
    }),
  }),
);
```

- [ ] **Step 3: Add frontend routing regression**

In `packages/batch-frontend/src/ui/students/StudentLearningPage.test.tsx`, update mocks to include `refreshProfileDraftFromApprovedCandidates: vi.fn()`. Add a test:

```tsx
await user.click(screen.getByRole('button', { name: 'Generate Draft Revision' }));

expect(apiMocks.refreshProfileDraftFromApprovedCandidates).toHaveBeenCalledWith('student-1', {
  candidateIds: ['candidate-approved'],
});
expect(apiMocks.promoteStudentProfileCandidates).not.toHaveBeenCalled();
```

- [ ] **Step 4: Run tests to verify red**

Run:

```powershell
pnpm --filter @esl-pipeline/batch-backend vitest run tests/application.profile-candidate-promotion.test.ts tests/application.profile-draft-refresh.test.ts
pnpm --filter @esl-pipeline/batch-frontend vitest run src/ui/students/StudentLearningPage.test.tsx
```

Expected: the new service/import/helper tests fail because the route and frontend helper do not exist yet.

---

### Task 5: Chunk 17 Backend Full Draft Refresh Implementation

**Files:**
- Create: `packages/batch-backend/src/application/profile-draft-refresh.ts`
- Modify: `packages/batch-backend/src/application/profile-revision-drafting.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/students-routes.ts`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.students-content.test.ts`

- [ ] **Step 1: Add the drafting operation name**

In `packages/batch-backend/src/application/profile-revision-drafting.ts`, extend `ProfileDraftingOperation`:

```ts
export type ProfileDraftingOperation =
  | 'candidate_promotion'
  | 'legacy_normalization'
  | 'lesson_population'
  | 'profile_revision_refresh';
```

- [ ] **Step 2: Create the full draft refresh service**

Create `packages/batch-backend/src/application/profile-draft-refresh.ts`. Structure it after `populate-first-profile-from-lesson.ts`, but sources should be active profile, student memory overview when available, and approved candidates. The service should:

```ts
export interface RefreshProfileDraftFromApprovedCandidatesRequest {
  studentId: string;
  candidateIds: string[];
  baseRevisionId?: string | null;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  maxOutputTokens?: number;
}
```

Use `generateProfileRevisionDraft` with:

```ts
request: {
  prompt,
  envelope,
  operation: 'profile_revision_refresh',
  maxOutputTokens: request.maxOutputTokens ?? dependencies.config.generation.maxOutputTokensHard,
  responseSchema: {
    name: FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_NAME,
    description: FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_DESCRIPTION,
    schema: FOUNDATIONAL_PROFILE_JSON_SCHEMA,
    strict: true,
  },
}
```

The prompt must include these labeled sections:

```text
[STUDENT_NAME]
[BASE_STRUCTURED_PROFILE]
[APPROVED_PROFILE_CANDIDATES]
[STUDENT_MEMORY_OVERVIEW]
[REVIEWER_NOTE]
```

The key instruction must be:

```text
Write a complete refreshed foundational_profile_v1 draft, not a candidate patch. Preserve durable teacher-authored truths, integrate selected approved candidates where useful, use memory evidence for context, and favor omission over invention.
```

Save with:

```ts
source: 'profile_revision_refresh',
status: 'draft',
dedupeByHash: false,
structuredContent: structuredDraft,
```

- [ ] **Step 3: Add the HTTP route**

In `packages/batch-backend/src/transport/extended-routes/students-routes.ts`, add:

```ts
app.post(
  '/students/:id/profile-drafts/refresh-from-approved-candidates',
  { preHandler: [authenticate] },
  async (request, reply) => {
    const routePath = resolveRoutePath(
      request,
      'POST /students/:id/profile-drafts/refresh-from-approved-candidates',
    );
    const paramsSchema = z.object({ id: z.string().min(1) });
    const bodySchema = z.object({
      candidateIds: z.array(z.string().min(1)).min(1),
      baseRevisionId: z.string().min(1).optional(),
      reviewerNote: z.string().trim().min(1).optional(),
    });

    const params = paramsSchema.parse(request.params ?? {});
    const body = bodySchema.parse(request.body ?? {});
    const authenticatedUser = getAuthenticatedUser(request);
    const result = await refreshProfileDraftFromApprovedCandidates({
      request: {
        studentId: params.id,
        candidateIds: body.candidateIds,
        baseRevisionId: body.baseRevisionId ?? null,
        reviewerId: authenticatedUser?.id ?? null,
        reviewerNote: body.reviewerNote ?? null,
      },
      overrides: { config: context.config },
    });

    logger.info('HTTP request handled', {
      event: 'http_request',
      route: routePath,
      statusCode: 200,
      studentId: params.id,
    });

    return reply.send({
      draftRevisionId: result.draftRevision.id,
      profileId: result.profileId,
      baseRevisionId: result.baseRevisionId,
      includedCandidateIds: result.includedCandidateIds,
      contentHash: result.draftRevision.contentHash,
      draftRevision: result.draftRevision,
      provider: result.provider,
      model: result.model,
      providerRequestId: result.providerRequestId,
      usage: result.usage,
    });
  },
);
```

Wrap errors using the same pattern as the promotion and populate-first routes.

- [ ] **Step 4: Add route integration test**

In `packages/batch-backend/tests/transport.http-server.integration.students-content.test.ts`, add a test for the new route that stubs the application service and asserts the response includes `draftRevision` and `includedCandidateIds`.

- [ ] **Step 5: Run backend tests**

Run:

```powershell
pnpm --filter @esl-pipeline/batch-backend vitest run tests/application.profile-candidate-promotion.test.ts tests/application.profile-draft-refresh.test.ts tests/transport.http-server.integration.students-content.test.ts
```

Expected: tests pass and candidate promotion remains a patch-only schema path.

---

### Task 6: Chunk 17 Frontend Routing Implementation

**Files:**
- Modify: `packages/batch-frontend/src/utils/api.ts`
- Modify: `packages/batch-frontend/src/ui/students/StudentLearningPage.tsx`
- Modify: `packages/batch-frontend/src/ui/students/StudentLearningPage.test.tsx`
- Optional Modify: `packages/batch-frontend/src/ui/students/WorkspaceCandidatesPanel.tsx`

- [ ] **Step 1: Add frontend API helper**

In `packages/batch-frontend/src/utils/api.ts`, add:

```ts
export async function refreshProfileDraftFromApprovedCandidates(
  studentId: string,
  payload: StudentProfileCandidatePromotionRequest,
): Promise<StudentProfileCandidatePromotionResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(
        `/students/${encodeURIComponent(studentId)}/profile-drafts/refresh-from-approved-candidates`,
      ),
      payload,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to refresh profile drafts.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}
```

- [ ] **Step 2: Route the button to the new helper**

In `packages/batch-frontend/src/ui/students/StudentLearningPage.tsx`, import `refreshProfileDraftFromApprovedCandidates` and replace:

```ts
const response = await promoteStudentProfileCandidates(studentId, {
```

with:

```ts
const response = await refreshProfileDraftFromApprovedCandidates(studentId, {
```

Keep the old `promoteStudentProfileCandidates` helper exported for the candidate-promotion route and any admin/safety flows.

- [ ] **Step 3: Update success and error copy**

Use copy that matches full draft refresh:

```ts
setProfileCandidatePromotionSuccess(
  'Structured draft revision refreshed from approved candidates.',
);
```

Keep existing no-selection and busy states.

- [ ] **Step 4: Run frontend tests**

Run:

```powershell
pnpm --filter @esl-pipeline/batch-frontend vitest run src/ui/students/StudentLearningPage.test.tsx src/ui/students/StudentWorkspace.candidates.test.tsx
```

Expected: tests pass and the visible "Generate Draft Revision" action calls the full-draft refresh helper.

- [ ] **Step 5: Commit Chunk 17**

Run:

```powershell
git add packages/batch-backend/src/application/profile-draft-refresh.ts packages/batch-backend/src/application/profile-revision-drafting.ts packages/batch-backend/src/transport/extended-routes/students-routes.ts packages/batch-backend/tests/application.profile-candidate-promotion.test.ts packages/batch-backend/tests/application.profile-draft-refresh.test.ts packages/batch-backend/tests/transport.http-server.integration.students-content.test.ts packages/batch-frontend/src/utils/api.ts packages/batch-frontend/src/ui/students/StudentLearningPage.tsx packages/batch-frontend/src/ui/students/StudentLearningPage.test.tsx packages/batch-frontend/src/ui/students/StudentWorkspace.candidates.test.tsx packages/batch-frontend/src/ui/students/WorkspaceCandidatesPanel.tsx
git commit -m "fix(batch): route profile draft refresh to full generation"
```

If `WorkspaceCandidatesPanel.tsx` is unchanged, omit it from `git add`.

---

### Task 7: Chunk 18 Failing Tests For Canonical Student Name Grounding

**Files:**
- Modify: `packages/batch-backend/tests/application.prompt-package.resolution.test.ts`
- Modify: `packages/batch-backend/tests/application.prompt-package.test-harness.ts`

- [ ] **Step 1: Add prompt package test for canonical student name**

In `packages/batch-backend/tests/application.prompt-package.resolution.test.ts`, add a test with a recording bound to `student-1` and a transcript that does not name the learner. Assert:

```ts
expect(result?.text).toContain('[CANONICAL_STUDENT_NAME]\nStudent One');
expect(result?.requestEnvelope).toEqual(
  expect.objectContaining({
    workload: 'assignment_draft',
    sources: expect.arrayContaining([
      expect.objectContaining({
        id: 'canonical-student-name',
        label: 'CANONICAL_STUDENT_NAME',
        content: 'Student One',
      }),
    ]),
  }),
);
```

- [ ] **Step 2: Add instruction assertion**

In the same test, assert the envelope instructions contain:

```ts
expect(JSON.stringify(result?.requestEnvelope)).toContain(
  'Use CANONICAL_STUDENT_NAME as the authoritative learner name',
);
```

- [ ] **Step 3: Run test to verify red**

Run:

```powershell
pnpm --filter @esl-pipeline/batch-backend vitest run tests/application.prompt-package.resolution.test.ts
```

Expected: the new assertions fail because prompt assembly does not include `CANONICAL_STUDENT_NAME`.

---

### Task 8: Chunk 18 Minimal Implementation

**Files:**
- Modify: `packages/batch-backend/src/application/create-prompt-package.ts`
- Modify: `packages/batch-backend/src/application/prompt-assembly.ts`
- Modify: `packages/batch-backend/tests/application.prompt-package.resolution.test.ts`

- [ ] **Step 1: Extend prompt stitch options**

In `packages/batch-backend/src/application/prompt-assembly.ts`, add:

```ts
canonicalStudentName?: string | null;
```

to `PromptStitchOptions`.

- [ ] **Step 2: Add canonical name block to flat prompt text**

In `stitchPromptPayload`, insert this before `FOUNDATIONAL_PROFILE`:

```ts
formatLabeledBlock(
  'CANONICAL_STUDENT_NAME',
  (options.canonicalStudentName ?? '').trim() || 'Not available.',
),
```

- [ ] **Step 3: Add canonical name to the envelope**

In `stitchPromptEnvelope`, prepend this instruction to the existing template:

```ts
[
  'Use CANONICAL_STUDENT_NAME as the authoritative learner name for assignment headers and student-facing copy. Do not infer or invent the learner name from the transcript.',
  options.template,
].join('\n\n')
```

Add this source before the profile source:

```ts
{
  id: 'canonical-student-name',
  label: 'CANONICAL_STUDENT_NAME',
  content: (options.canonicalStudentName ?? '').trim() || 'Not available.',
},
```

- [ ] **Step 4: Resolve canonical student name in prompt package creation**

In `packages/batch-backend/src/application/create-prompt-package.ts`, track the student lookup result:

```ts
let canonicalStudentName: string | null = null;
if (recording?.studentId) {
  const studentProfile = await students.getById(recording.studentId, { config });
  canonicalStudentName = studentProfile?.student ?? null;
  studentProfileId = studentProfile?.profileId ?? null;
  // existing binding fallback remains unchanged
}
```

Pass it into both prompt assembly calls:

```ts
canonicalStudentName,
```

- [ ] **Step 5: Run Chunk 18 tests**

Run:

```powershell
pnpm --filter @esl-pipeline/batch-backend vitest run tests/application.prompt-package.resolution.test.ts tests/application.draft.test.ts
```

Expected: tests pass and assignment draft generation keeps using the enriched `assignment_draft` envelope.

- [ ] **Step 6: Commit Chunk 18**

Run:

```powershell
git add packages/batch-backend/src/application/create-prompt-package.ts packages/batch-backend/src/application/prompt-assembly.ts packages/batch-backend/tests/application.prompt-package.resolution.test.ts packages/batch-backend/tests/application.prompt-package.test-harness.ts
git commit -m "fix(batch): ground assignment prompts with student name"
```

---

### Task 9: Integrated Validation

**Files:**
- Read: `tmp/check-logs/**` if agent lanes fail
- Optional Modify: implementation files only for failures directly tied to the chunks

- [ ] **Step 1: Run focused package checks**

Run:

```powershell
pnpm --filter @esl-pipeline/orchestrator vitest run tests/rerun-publish-student-name.test.ts
pnpm --filter @esl-pipeline/batch-backend vitest run tests/infrastructure.pipeline-worker-entry.test.ts tests/application.profile-candidate-promotion.test.ts tests/application.profile-draft-refresh.test.ts tests/application.prompt-package.resolution.test.ts tests/transport.http-server.integration.students-content.test.ts
pnpm --filter @esl-pipeline/batch-frontend vitest run src/ui/students/StudentLearningPage.test.tsx src/ui/students/StudentWorkspace.candidates.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run repo formatting and affected checks**

Run:

```powershell
pnpm format
pnpm run lint:repo-hygiene
pnpm --silent run check:fast:agent
```

Expected: all pass. If `check:fast:agent` fails, read the reported artifact under `tmp/check-logs/...` before rerunning raw commands.

- [ ] **Step 3: Run broader check because backend, frontend, and orchestrator behavior changed**

Run:

```powershell
pnpm check:pre-pr
```

Expected: pass.

- [ ] **Step 4: Manual local smoke**

Run the local batch stack only if the checks pass and the environment is ready:

```powershell
pnpm docker:up
```

Smoke steps:

1. Generate one normal assignment for a test student whose transcript omits the student's name.
2. Inspect the prompt package payload or backend logs to confirm `CANONICAL_STUDENT_NAME` is present.
3. Generate the assignment draft and confirm the header uses the selected student name.
4. Publish the assignment and confirm the normal yellow theme.
5. Trigger a republish or pronunciation rerun on the same job and confirm the rerun page keeps the yellow theme.
6. Open the Learning page, approve one candidate, click "Generate Draft Revision", and confirm a full structured draft opens without the truncated-draft error.

Stop local stack:

```powershell
pnpm docker:dev:down
```

---

### Task 10: Docs, PR, Merge, And Deploy

**Files:**
- Modify: `docs/plans/2026-06-23-alpha-readiness.md`
- Optional Modify: `docs/operations/hosted-mvp-evidence.md`
- Read: `docs/backend-frontend/DEPLOYMENT.md`
- Read: `docs/reference/VERSIONING_MODEL.md`

- [ ] **Step 1: Update alpha readiness plan after validation**

In `docs/plans/2026-06-23-alpha-readiness.md`, mark Chunks 16-18 as complete only after focused tests, `check:fast:agent`, and `check:pre-pr` pass. Include the exact validation commands run.

- [ ] **Step 2: Commit docs closeout**

Run:

```powershell
git add docs/plans/2026-06-23-alpha-readiness.md
git commit -m "docs(alpha): record chunks 16 to 18 validation"
```

- [ ] **Step 3: Push and create PR**

Run:

```powershell
git push -u origin codex/alpha-chunks-16-18-fixes
gh pr create --base main --head codex/alpha-chunks-16-18-fixes --title "fix: repair alpha assignment rerun and profile draft flows" --body-file .github/pull_request_template.md --label release:patch
```

Fill the PR template sections exactly:

```markdown
## Summary
- Preserves HTML color theme preset through assignment reruns.
- Routes profile draft revision generation to full foundational-profile drafting while keeping candidate promotion patch-only.
- Adds canonical student display name to assignment prompt envelopes.

## Validation
- pnpm --filter @esl-pipeline/orchestrator vitest run tests/rerun-publish-student-name.test.ts
- pnpm --filter @esl-pipeline/batch-backend vitest run ...
- pnpm --filter @esl-pipeline/batch-frontend vitest run ...
- pnpm format
- pnpm run lint:repo-hygiene
- pnpm --silent run check:fast:agent
- pnpm check:pre-pr

## Risk Notes
- No migrations or contract-version files changed.
- Production deploy uses release images from the merge commit/release commit, not server-local edits.

## Checklist
- [x] Tests updated or not needed
- [x] Docs updated or not needed
- [x] Release label selected
```

- [ ] **Step 4: Verify PR label**

Run:

```powershell
gh pr view --json number,labels
```

Expected: exactly one label, `release:patch`.

- [ ] **Step 5: Wait for CI and address failures**

Run:

```powershell
gh pr checks <pr-number>
gh pr view <pr-number> --comments
```

Expected: required checks pass before merge. Fix only failures related to this branch.

- [ ] **Step 6: Merge after approval**

Run:

```powershell
gh pr merge <pr-number> --merge --delete-branch
```

Expected: PR merged to `main`; release workflow creates the release commit, tag, and GHCR images.

- [ ] **Step 7: Deploy reviewed release image to Lightsail**

After release images are published, SSH to the VPS and run the deployment script with the 40-character release commit SHA:

```bash
cd /opt/esl-pipeline
bash scripts/deploy/deploy-prod-images.sh <40-char-git-sha>
```

Expected: script pulls SHA-tagged images, records digests under `/var/lib/esl-pipeline/deploy`, verifies Postgres health, creates and verifies backup, runs migrations if any, updates services, and runs bounded smoke checks.

- [ ] **Step 8: Post-deploy production smoke**

Run on the VPS:

```bash
curl -fsS https://<public-hostname>/api/health
curl -fsS https://<public-hostname>/api/meta/version
docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env \
  ps student-memory-worker
```

Manual smoke:

1. Confirm app loads over HTTPS.
2. Generate or inspect a test prompt package for a selected student and verify canonical student name grounding.
3. Generate a draft revision from approved profile candidates and verify no truncated-draft error.
4. Republish or rerun an assignment and verify the normal yellow theme remains.

- [ ] **Step 9: Record deployment evidence**

Update `docs/operations/hosted-mvp-evidence.md` or the active deployment evidence note with:

```markdown
- Deployed SHA: `<40-char-git-sha>`
- Release tag: `vX.Y.Z`
- Deploy command: `bash scripts/deploy/deploy-prod-images.sh <40-char-git-sha>`
- Health: `/api/health` passed
- Version: `/api/meta/version` returned deployed SHA/version
- Smoke: rerun theme preserved, profile draft refresh saved, assignment prompt included canonical student name
```

Commit evidence if the repo policy for that evidence note requires it.

---

## Self-Review

- Spec coverage:
  - Chunk 16 is covered by Tasks 2-3 and manual smoke in Task 9.
  - Chunk 17 is covered by Tasks 4-6 and preserves candidate-promotion safety via explicit regression.
  - Chunk 18 is covered by Tasks 7-8 and keeps the identity payload minimal.
  - Deployment is covered by Task 10 and follows `docs/backend-frontend/DEPLOYMENT.md`.
- Placeholder scan:
  - No implementation step depends on unspecified files or generic "add tests" language.
- Type consistency:
  - `preset` is added to `RerunFlags` and forwarded from existing backend `RunRerunAssignmentPayload`.
  - Full draft refresh uses `foundational_profile_v1`; candidate promotion remains `profile_candidate_patch_v1`.
  - Assignment prompt name source uses `CANONICAL_STUDENT_NAME` consistently in payload and envelope.

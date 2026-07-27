# Business Workspace Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this
> plan task-by-task. Repository rules require the primary agent to perform all edits inline; do not
> delegate implementation to subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent authenticated tutors from reading or mutating another workspace's business
dashboard or student schedule/billing data.

**Architecture:** Resolve the authenticated user's primary workspace at each affected HTTP route,
pass that workspace as a required first argument through the application layer, and qualify every
affected SQL read/write by workspace. Preserve legacy null-workspace rows only for the historical
default workspace and separate request-scoped recurrence materialization from trusted all-workspace
maintenance.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Vitest, pnpm, GitHub Actions

## Global Constraints

- Implement only GitHub issue #160; do not bundle product-truth issue #143 or UI redesign #144.
- The primary agent owns every code, test, and documentation edit inline.
- Use read-only `sol_reviewer` only for the integrated authorization review gate and send follow-up
  review to the same reviewer when available.
- Begin each behavior batch with a focused failing test and preserve the failure evidence.
- Never accept workspace identity from request input; derive it only from authenticated membership.
- Foreign student and lesson identifiers return the existing non-enumerating `404 not_found` shape.
- Null `workspace_id` rows are compatible only with the fixed default workspace.
- Do not change public DTOs, API paths, database schema, migrations, contract versions, environment
  variables, business calculations, or frontend behavior.
- Do not inspect or mutate production data and do not deploy.
- Run focused tests and `pnpm --silent run check:fast:agent` locally.
- Do not run the full local `pnpm check`; GitHub Actions on a draft PR owns broad validation.
- Use release label `release:patch`.

---

## File Structure

- Modify `packages/batch-backend/tests/application.student-schedule-billing.test.ts`
  - add synthetic two-user/two-workspace fixtures and real-query isolation regressions.
- Modify `packages/batch-backend/src/application/teacher-business-dashboard.ts`
  - require workspace context and qualify every dashboard query.
- Modify `packages/batch-backend/src/application/student-schedule-billing.ts`
  - require workspace context for student business operations and split recurrence materialization
    authority.
- Modify `packages/batch-backend/tests/transport.http-server.integration.harness.ts`
  - expose workspace and student-business mocks required by route contract assertions.
- Modify `packages/batch-backend/tests/transport.http-server.integration.business.test.ts`
  - prove membership resolution and workspace propagation for all dashboard routes.
- Modify `packages/batch-backend/tests/transport.http-server.integration.students-content.test.ts`
  - prove membership resolution and workspace propagation for all ten student business routes.
- Modify `packages/batch-backend/src/transport/extended-routes/business-routes.ts`
  - resolve membership and map workspace errors.
- Modify `packages/batch-backend/src/transport/extended-routes/students-routes.ts`
  - pass the existing resolved workspace to every student schedule/billing call and map errors.
- Modify `packages/batch-backend/README.md`
  - record the tutor-workspace authorization boundary.
- Modify `docs/backend-frontend/batch-backend-ssot.md`
  - record transport and application ownership of workspace authorization.

---

### Task 1: Prove and contain dashboard-wide workspace isolation

**Files:**

- Modify: `packages/batch-backend/tests/application.student-schedule-billing.test.ts:6-295`
- Modify: `packages/batch-backend/tests/application.student-schedule-billing.test.ts:1193-1460`
- Modify: `packages/batch-backend/src/application/teacher-business-dashboard.ts:198-755`
- Modify: `packages/batch-backend/src/application/student-schedule-billing.ts:1001-1032`

**Interfaces:**

- Consumes: `resolvePrimaryWorkspaceIdForUser(userId: string): Promise<string>` from
  `application/workspace-context.ts` in the test fixture.
- Produces:

```ts
getBusinessSettings(workspaceId: string): Promise<BusinessSettingsDto>;
updateBusinessSettings(
  workspaceId: string,
  params: UpdateBusinessSettingsRequest,
  actorUserId?: string | null,
): Promise<BusinessSettingsDto>;
getBusinessScheduleSurface(
  workspaceId: string,
  params?: { from?: string; to?: string },
): Promise<BusinessScheduleSurfaceResponse>;
getBusinessStatsSurface(
  workspaceId: string,
  params?: { month?: string },
): Promise<BusinessStatsSurfaceResponse>;
materializeWorkspaceLessonRecurrencesWithClient(
  client: PoolClient,
  workspaceId: string,
): Promise<void>;
materializeAllWorkspaceLessonRecurrences(): Promise<void>;
```

- [ ] **Step 1: Generalize test fixtures for two workspaces**

Add helpers that always take workspace identity explicitly:

```ts
async function seedWorkspaceTutor(label: string) {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `INSERT INTO users (id, email, password_hash, role)
      VALUES ($1, $2, 'hash', 'user')`,
      [userId, `${label}@example.test`],
    );
    await client.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [
      workspaceId,
      `${label} workspace`,
    ]);
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );
    await client.query(
      `INSERT INTO workspace_business_settings
         (workspace_id, default_currency, default_lesson_rate_minor, timezone)
       VALUES ($1, $2, $3, 'UTC')`,
      [workspaceId, label === 'alpha' ? 'USD' : 'EUR', label === 'alpha' ? 4000 : 7000],
    );
  });
  return { userId, workspaceId };
}

async function seedStudentInWorkspace(workspaceId: string, name: string) {
  const studentId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, (client) =>
    client.query(
      `INSERT INTO students (id, student, workspace_id, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [studentId, name, workspaceId],
    ),
  );
  return studentId;
}
```

Update `insertBusinessLesson`, `insertBusinessCreditEvent`, and `insertBusinessPayment` to require a
`workspaceId` argument instead of inserting `DEFAULT_WORKSPACE_ID` internally. Update existing
single-workspace callers to pass `DEFAULT_WORKSPACE_ID` so old coverage remains explicit.

- [ ] **Step 2: Write failing two-workspace dashboard tests**

Add tests that resolve each fixture user's workspace, seed distinct dashboard data, then call the
new workspace-first signatures:

```ts
it('isolates business settings, schedule, and stats by tutor workspace', async () => {
  const alpha = await seedWorkspaceTutor('alpha');
  const beta = await seedWorkspaceTutor('beta');
  const alphaStudentId = await seedStudentInWorkspace(alpha.workspaceId, 'Alpha student');
  const betaStudentId = await seedStudentInWorkspace(beta.workspaceId, 'Beta student');

  await insertBusinessLesson({
    workspaceId: alpha.workspaceId,
    studentId: alphaStudentId,
    startsAt: '2026-05-08T10:00:00.000Z',
    status: 'completed',
    consumesCredit: true,
  });
  await insertBusinessLesson({
    workspaceId: beta.workspaceId,
    studentId: betaStudentId,
    startsAt: '2026-05-08T11:00:00.000Z',
    status: 'completed',
    consumesCredit: true,
  });
  await insertBusinessPayment({
    workspaceId: alpha.workspaceId,
    studentId: alphaStudentId,
    amountMinor: 12000,
    currency: 'USD',
    receivedAt: '2026-05-08',
  });
  await insertBusinessPayment({
    workspaceId: beta.workspaceId,
    studentId: betaStudentId,
    amountMinor: 21000,
    currency: 'EUR',
    receivedAt: '2026-05-08',
  });

  const alphaWorkspaceId = await resolvePrimaryWorkspaceIdForUser(alpha.userId);
  const settings = await getBusinessSettings(alphaWorkspaceId);
  const schedule = await getBusinessScheduleSurface(alphaWorkspaceId, {
    from: '2026-05-08',
    to: '2026-05-08',
  });
  const stats = await getBusinessStatsSurface(alphaWorkspaceId, { month: '2026-05' });

  expect(settings).toMatchObject({ workspaceId: alpha.workspaceId, defaultCurrency: 'USD' });
  expect(schedule.lessons.map((lesson) => lesson.studentId)).toEqual([alphaStudentId]);
  expect(stats).toMatchObject({
    workspaceId: alpha.workspaceId,
    currency: 'USD',
    collectedMinor: 12000,
  });
});
```

Add separate assertions that:

- `updateBusinessSettings(alpha.workspaceId, ..., alpha.userId)` changes only alpha;
- alpha schedule/stats exclude beta reminders, credits, lessons, and payments;
- alpha dashboard materialization does not add lessons or advance
  `student_lesson_recurrence_rules.materialized_through` for beta; and
- a null-workspace student/lesson/payment is visible from `DEFAULT_WORKSPACE_ID` and absent from
  alpha's non-default workspace.

- [ ] **Step 3: Run the focused PostgreSQL test and capture the expected red state**

Run:

```powershell
pnpm --filter @esl-pipeline/batch-backend exec vitest run `
  --config ../../vitest.config.ts `
  --reporter=dot `
  --maxWorkers=1 `
  ../../packages/batch-backend/tests/application.student-schedule-billing.test.ts
```

Expected: FAIL because the current dashboard signatures do not accept workspace-first arguments and
the implementation still returns or updates the default workspace.

- [ ] **Step 4: Require workspace identity in dashboard entrypoints**

Change the four exported signatures to the interfaces above. Replace every
`DEFAULT_WORKSPACE_ID` application argument and returned field with the required `workspaceId`.
Thread the workspace ID into every private helper that reads settings, lessons, recurrence,
reminders, credits, or payments.

For each nullable legacy column, use an explicit default-only predicate. Adapt placeholder numbers
to each query's existing parameter order:

```sql
WHERE (
  student_lessons.workspace_id = $workspace_param::uuid
  OR (
    student_lessons.workspace_id IS NULL
    AND $workspace_param::uuid = $default_workspace_param::uuid
  )
)
```

Do not use the requested workspace as the fallback side of `COALESCE`.

`getBusinessSettingsForWorkspace()` may insert a missing settings row for the supplied workspace,
but it must not create or select the default workspace unless the supplied ID is the default. The
membership foreign key guarantees a normal invited workspace already exists.

- [ ] **Step 5: Split request-scoped and all-workspace recurrence materialization**

Rename the trusted no-argument operation to make its authority explicit and give dashboard requests
a required workspace path:

```ts
export async function materializeAllWorkspaceLessonRecurrences(): Promise<void> {
  await withPgClient(async (client) => {
    await materializeLessonRecurrencesForRows(client, await listRecurrenceStudents(client));
  });
}

export async function materializeWorkspaceLessonRecurrencesWithClient(
  client: PoolClient,
  workspaceId: string,
): Promise<void> {
  const students = await listRecurrenceStudents(client, workspaceId);
  await materializeLessonRecurrencesForRows(client, students);
}
```

The workspace-qualified selector uses the default-only null predicate. Confirm with `rg` that no
dashboard call reaches the all-workspace function and no stale import of the old no-argument name
remains.

- [ ] **Step 6: Re-run the focused PostgreSQL test**

Run the Step 3 command again.

Expected: PASS, including existing default-workspace behavior and the new two-workspace dashboard
isolation cases.

- [ ] **Step 7: Commit the dashboard isolation batch**

```powershell
git add packages/batch-backend/src/application/teacher-business-dashboard.ts `
  packages/batch-backend/src/application/student-schedule-billing.ts `
  packages/batch-backend/tests/application.student-schedule-billing.test.ts
git commit -m "fix(backend): scope business dashboard by workspace"
```

---

### Task 2: Enforce workspace ownership for student schedule/billing operations

**Files:**

- Modify: `packages/batch-backend/tests/application.student-schedule-billing.test.ts`
- Modify: `packages/batch-backend/src/application/student-schedule-billing.ts:238-687`
- Modify: `packages/batch-backend/src/application/student-schedule-billing.ts:739-769`

**Interfaces:**

- Consumes: required workspace IDs and the dashboard-safe recurrence functions from Task 1.
- Produces these workspace-first application signatures:

```ts
getStudentScheduleBillingSurface(workspaceId: string, studentId: string): Promise<StudentScheduleBillingSurfaceResponse | null>;
hideStudentLessonFollowupReminder(workspaceId: string, studentId: string, lessonId: string, actorUserId?: string | null): Promise<StudentScheduleBillingSurfaceResponse>;
undoLatestHiddenStudentReminder(workspaceId: string, studentId: string, actorUserId?: string | null): Promise<StudentScheduleBillingSurfaceResponse>;
updateStudentLessonPlan(workspaceId: string, studentId: string, params: UpdateStudentLessonPlanRequest, actorUserId?: string | null): Promise<StudentScheduleBillingSurfaceResponse>;
upsertPrimaryStudentLessonRecurrence(workspaceId: string, studentId: string, params: UpsertStudentLessonRecurrenceRequest, actorUserId?: string | null): Promise<StudentScheduleBillingSurfaceResponse>;
createStudentLesson(workspaceId: string, studentId: string, params: CreateStudentLessonRequest, actorUserId?: string | null): Promise<StudentScheduleBillingSurfaceResponse>;
updateStudentLesson(workspaceId: string, studentId: string, lessonId: string, params: UpdateStudentLessonRequest, actorUserId?: string | null): Promise<StudentScheduleBillingSurfaceResponse>;
addStudentPackage(workspaceId: string, studentId: string, params: AddStudentPackageRequest, actorUserId?: string | null): Promise<StudentScheduleBillingSurfaceResponse>;
adjustStudentCredits(workspaceId: string, studentId: string, params: { quantityDelta: number; note?: string | null }, actorUserId?: string | null): Promise<StudentScheduleBillingSurfaceResponse>;
recordStudentPayment(workspaceId: string, studentId: string, params: RecordStudentPaymentRequest, actorUserId?: string | null): Promise<StudentScheduleBillingSurfaceResponse>;
```

- [ ] **Step 1: Add a database mutation snapshot helper**

Add a helper that records counts and stable values for the foreign student's business rows:

```ts
async function readStudentBusinessMutationSnapshot(studentId: string) {
  return withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    const result = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM student_lesson_plans WHERE student_id = $1) AS lesson_plans,
         (SELECT COUNT(*)::int FROM student_lesson_recurrence_rules WHERE student_id = $1) AS recurrence_rules,
         (SELECT COUNT(*)::int FROM student_lessons WHERE student_id = $1) AS lessons,
         (SELECT COUNT(*)::int FROM student_credit_events WHERE student_id = $1) AS credit_events,
         (SELECT COUNT(*)::int FROM student_payment_records WHERE student_id = $1) AS payments,
         (SELECT hidden_lesson_followup_keys FROM student_reminder_preferences WHERE student_id = $1)
           AS hidden_keys`,
      [studentId],
    );
    return result.rows[0];
  });
}
```

- [ ] **Step 2: Write failing foreign-student read and mutation tests**

Seed alpha and beta workspaces plus a beta student and lesson. Verify the read is hidden:

```ts
await expect(
  getStudentScheduleBillingSurface(alpha.workspaceId, betaStudentId),
).resolves.toBeNull();
```

Create a table of all nine mutations using valid payloads and assert each rejects with the existing
not-found error while the database snapshot remains unchanged:

```ts
const attempts = [
  () =>
    updateStudentLessonPlan(alpha.workspaceId, betaStudentId, { timezone: 'UTC' }, alpha.userId),
  () =>
    upsertPrimaryStudentLessonRecurrence(
      alpha.workspaceId,
      betaStudentId,
      validRecurrence,
      alpha.userId,
    ),
  () => createStudentLesson(alpha.workspaceId, betaStudentId, validLesson, alpha.userId),
  () =>
    updateStudentLesson(
      alpha.workspaceId,
      betaStudentId,
      betaLessonId,
      { title: 'blocked' },
      alpha.userId,
    ),
  () =>
    hideStudentLessonFollowupReminder(alpha.workspaceId, betaStudentId, betaLessonId, alpha.userId),
  () => undoLatestHiddenStudentReminder(alpha.workspaceId, betaStudentId, alpha.userId),
  () => addStudentPackage(alpha.workspaceId, betaStudentId, { lessons: 4 }, alpha.userId),
  () => adjustStudentCredits(alpha.workspaceId, betaStudentId, { quantityDelta: 2 }, alpha.userId),
  () => recordStudentPayment(alpha.workspaceId, betaStudentId, validPayment, alpha.userId),
];

for (const attempt of attempts) {
  const before = await readStudentBusinessMutationSnapshot(betaStudentId);
  await expect(attempt()).rejects.toMatchObject({ code: 'not_found', status: 404 });
  expect(await readStudentBusinessMutationSnapshot(betaStudentId)).toEqual(before);
}
```

Use the concrete valid recurrence, lesson, and payment payload shapes already present in this test
file; do not bypass their domain validation.

Add a default-workspace compatibility test showing a null-workspace student is found only when
`workspaceId === DEFAULT_WORKSPACE_ID`.

- [ ] **Step 3: Run the focused PostgreSQL test and capture the expected red state**

Run the Task 1 Step 3 command.

Expected: FAIL because the current student functions accept no workspace ID and `getStudentContext`
filters only by student ID.

- [ ] **Step 4: Make workspace ownership the shared student-context predicate**

Change `getStudentContext` and `requireStudentContext` to accept workspace first:

```ts
async function getStudentContext(
  client: PoolClient,
  workspaceId: string,
  studentId: string,
): Promise<StudentContext | null> {
  const result = await client.query<StudentContextRow>(
    `SELECT id, student, COALESCE(workspace_id, $3::uuid) AS workspace_id
     FROM students
     WHERE id = $1
       AND archived_at IS NULL
       AND (
         workspace_id = $2::uuid
         OR (workspace_id IS NULL AND $2::uuid = $3::uuid)
       )`,
    [studentId, workspaceId, DEFAULT_WORKSPACE_ID],
  );
  const row = result.rows[0];
  return row ? { id: row.id, name: row.student, workspaceId: row.workspace_id } : null;
}
```

Thread the required workspace ID through all ten exported functions. Every mutation must call
`requireStudentContext(client, workspaceId, studentId)` before reading or writing nested business
rows. Keep lesson lookup constrained by both authorized `studentId` and `lessonId`.

Update trusted internal callers such as generated lesson title or elapsed-lesson completion only if
TypeScript identifies them as consumers of the changed helpers; do not add caller-supplied workspace
authority where the internal operation already derives workspace from an owned lesson record.

- [ ] **Step 5: Update existing application test calls**

Make every existing direct call explicit by adding `DEFAULT_WORKSPACE_ID` as the first argument.
Use TypeScript and `rg` to find every call site:

```powershell
rg -n "(getStudentScheduleBillingSurface|hideStudentLessonFollowupReminder|undoLatestHiddenStudentReminder|updateStudentLessonPlan|upsertPrimaryStudentLessonRecurrence|createStudentLesson|updateStudentLesson|addStudentPackage|adjustStudentCredits|recordStudentPayment)\(" packages/batch-backend/src packages/batch-backend/tests
```

Do not satisfy compilation by making `workspaceId` optional or defaulting it inside an exported
request-facing function.

- [ ] **Step 6: Re-run the focused PostgreSQL test**

Run the Task 1 Step 3 command again.

Expected: PASS, including all nine rejected mutations with unchanged database snapshots.

- [ ] **Step 7: Commit the student operation batch**

```powershell
git add packages/batch-backend/src/application/student-schedule-billing.ts `
  packages/batch-backend/tests/application.student-schedule-billing.test.ts
git commit -m "fix(backend): authorize student business operations"
```

---

### Task 3: Propagate authenticated workspace through HTTP routes

**Files:**

- Modify: `packages/batch-backend/tests/transport.http-server.integration.harness.ts:38-42`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.harness.ts:175-184`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.harness.ts:321-360`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.harness.ts:469-484`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.harness.ts:1325-1352`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.business.test.ts`
- Modify: `packages/batch-backend/tests/transport.http-server.integration.students-content.test.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/business-routes.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/students-routes.ts:495-764`
- Modify: `packages/batch-backend/src/transport/extended-routes/students-routes.ts:2377-2402`

**Interfaces:**

- Consumes: workspace-first application signatures from Tasks 1 and 2.
- Produces: all fourteen scoped routes resolve `test-user-id` to
  `00000000-0000-4000-8000-000000000001` and pass that workspace to the application layer.

- [ ] **Step 1: Expose all authorization-relevant mocks from the HTTP harness**

Import the mocked workspace module after its `vi.mock`, then create and expose:

```ts
const mockResolvePrimaryWorkspaceIdForUser = vi.mocked(
  workspaceContextModule.resolvePrimaryWorkspaceIdForUser,
);
const mockUpdateStudentLessonPlan = vi.mocked(studentScheduleBillingModule.updateStudentLessonPlan);
const mockCreateStudentLesson = vi.mocked(studentScheduleBillingModule.createStudentLesson);
const mockUpdateStudentLesson = vi.mocked(studentScheduleBillingModule.updateStudentLesson);
const mockHideStudentLessonFollowupReminder = vi.mocked(
  studentScheduleBillingModule.hideStudentLessonFollowupReminder,
);
const mockUndoLatestHiddenStudentReminder = vi.mocked(
  studentScheduleBillingModule.undoLatestHiddenStudentReminder,
);
const mockAddStudentPackage = vi.mocked(studentScheduleBillingModule.addStudentPackage);
const mockAdjustStudentCredits = vi.mocked(studentScheduleBillingModule.adjustStudentCredits);
const mockRecordStudentPayment = vi.mocked(studentScheduleBillingModule.recordStudentPayment);
```

Add the missing mocked exports for reminder hide/undo to the `vi.mock` factory. Give every mock a
valid resolved surface in the shared setup, and pass all mock handles to the suite callback.

- [ ] **Step 2: Write failing dashboard route propagation tests**

Update each expectation in `transport.http-server.integration.business.test.ts`:

```ts
expect(mockResolvePrimaryWorkspaceIdForUser).toHaveBeenCalledWith('test-user-id');
expect(mockGetBusinessSettings).toHaveBeenCalledWith(DEFAULT_WORKSPACE_ID);
expect(mockUpdateBusinessSettings).toHaveBeenCalledWith(
  DEFAULT_WORKSPACE_ID,
  expectedBody,
  'test-user-id',
);
expect(mockGetBusinessScheduleSurface).toHaveBeenCalledWith(DEFAULT_WORKSPACE_ID, expectedQuery);
expect(mockGetBusinessStatsSurface).toHaveBeenCalledWith(DEFAULT_WORKSPACE_ID, expectedQuery);
```

Add one test that makes `mockResolvePrimaryWorkspaceIdForUser` reject with
`new WorkspaceContextError()` and expects status `403` plus `{ error: 'workspace_required' }`.
Restore the default mock resolution after the test.

- [ ] **Step 3: Write failing student route propagation tests**

For the schedule/billing read and each of the nine mutation routes, assert:

```ts
expect(mockResolvePrimaryWorkspaceIdForUser).toHaveBeenCalledWith('test-user-id');
expect(mockApplicationFunction).toHaveBeenCalledWith(
  DEFAULT_WORKSPACE_ID,
  expectedStudentId,
  // route-specific IDs or payload,
  // authenticated actor last for mutations,
);
```

Add a missing-membership test for one route handled through `handleScheduleBillingRouteError` and
expect the canonical `403 workspace_required` response. The shared helper behavior covers the
remaining routes; individual propagation expectations cover every call site.

- [ ] **Step 4: Run focused HTTP integration tests and capture the expected red state**

Run:

```powershell
pnpm --filter @esl-pipeline/batch-backend exec vitest run `
  --config ../../vitest.config.ts `
  --reporter=dot `
  --maxWorkers=1 `
  ../../packages/batch-backend/tests/transport.http-server.integration.business.test.ts `
  ../../packages/batch-backend/tests/transport.http-server.integration.students-content.test.ts
```

Expected: FAIL because current routes do not resolve or pass workspace context for these calls.

- [ ] **Step 5: Resolve workspace in business routes**

Import `resolvePrimaryWorkspaceIdForUser` and `WorkspaceContextError`. Add a local helper equivalent
to the established student route helper:

```ts
async function resolveWorkspaceIdForRequest(request: FastifyRequest): Promise<string> {
  const authenticatedUser = getAuthenticatedUser(request);
  if (!authenticatedUser) throw new WorkspaceContextError('Authentication required');
  return resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
}
```

Resolve the workspace inside each handler after schema parsing where applicable, pass it first to
the application call, and map `WorkspaceContextError` in `handleBusinessRouteError`:

```ts
if (error instanceof WorkspaceContextError) {
  return reply.code(error.status).send({
    error: error.code,
    message: error.message,
    code: error.code,
  });
}
```

- [ ] **Step 6: Resolve workspace in student business routes**

Call the existing `resolveWorkspaceIdForRequest(request)` in all ten handlers and pass the result
first to the application function. Add this branch to `handleScheduleBillingRouteError` before its
generic logger:

```ts
const workspaceError = workspaceContextErrorResponse(reply, error);
if (workspaceError) return workspaceError;
```

Do not accept workspace identity from request parameters or reuse `authenticatedUser.id` as the
workspace ID.

- [ ] **Step 7: Re-run the focused HTTP integration tests**

Run the Step 4 command again.

Expected: PASS with all route propagation and missing-membership cases.

- [ ] **Step 8: Run backend typecheck**

Run:

```powershell
pnpm --filter @esl-pipeline/batch-backend typecheck
```

Expected: PASS. Any missed call site must be updated to pass an explicit, authoritative workspace;
do not make the new parameters optional to silence the compiler.

- [ ] **Step 9: Commit the transport batch**

```powershell
git add packages/batch-backend/src/transport/extended-routes/business-routes.ts `
  packages/batch-backend/src/transport/extended-routes/students-routes.ts `
  packages/batch-backend/tests/transport.http-server.integration.harness.ts `
  packages/batch-backend/tests/transport.http-server.integration.business.test.ts `
  packages/batch-backend/tests/transport.http-server.integration.students-content.test.ts
git commit -m "fix(backend): propagate tutor workspace to business routes"
```

---

### Task 4: Synchronize behavior documentation and prepare the draft PR validation boundary

**Files:**

- Modify: `packages/batch-backend/README.md:20-45`
- Modify: `docs/backend-frontend/batch-backend-ssot.md:70-110`
- Review: `docs/superpowers/specs/2026-07-27-business-workspace-authorization-design.md`
- Review: `docs/superpowers/plans/2026-07-27-business-workspace-authorization.md`

**Interfaces:**

- Consumes: integrated code and tests from Tasks 1-3.
- Produces: durable authorization documentation, bounded local validation evidence, one read-only
  security review result, and a `release:patch` draft PR whose GitHub Actions checks own broad
  validation.

- [ ] **Step 1: Update backend behavior documentation**

Add this invariant to the package README's runtime surface or operational notes:

```md
- Business dashboard and student schedule/billing routes derive the tutor's primary workspace from
  authenticated membership. Application queries require that workspace explicitly; foreign
  student and lesson IDs remain non-enumerating not-found responses.
```

Add the ownership split to the backend SSOT data/workflow invariants:

```md
- Transport authentication identifies the caller, `workspace-context.ts` resolves the caller's
  primary membership, and business application queries enforce that workspace. Audit actor IDs do
  not grant data access, and legacy null-workspace rows belong only to the historical default
  workspace.
```

Do not update feature claims, forecast semantics, frontend documentation, #143, or #144.

- [ ] **Step 2: Run focused tests once against the integrated branch**

Run the Task 1 PostgreSQL command and Task 3 HTTP command. Both must pass with fresh output.

- [ ] **Step 3: Run bounded repository validation**

Run:

```powershell
pnpm format:write
pnpm format
pnpm run lint:repo-hygiene
pnpm --silent run check:fast:agent
```

Expected: PASS. If an agent lane fails, read the exact artifact under `tmp/check-logs` before
rerunning a narrower raw command. Do not run `pnpm check` locally, even as a fallback; record the
laptop constraint and delegate the broad gate to the draft PR.

- [ ] **Step 4: Run the integrated read-only reviewer gate**

Dispatch one `sol_reviewer` with:

- issue #160 and the approved design/plan paths;
- the complete diff from `origin/main`;
- focused test and `check:fast:agent` evidence;
- explicit questions about missing route coverage, SQL workspace predicates, null-workspace
  leakage, audit-vs-authorization confusion, non-enumerating errors, and recurrence side effects.

The reviewer must not edit files. Fix every valid critical or important finding inline, rerun the
smallest affected test, and send the same reviewer a follow-up for the same authorization context.

- [ ] **Step 5: Commit docs and any reviewed corrections**

```powershell
git add packages/batch-backend/README.md `
  docs/backend-frontend/batch-backend-ssot.md `
  packages/batch-backend/src `
  packages/batch-backend/tests
git commit -m "docs(backend): record business workspace authorization"
```

If reviewer corrections already belong in the preceding focused commit, amend only when that commit
has not been pushed; otherwise use a focused `fix(backend): ...` follow-up commit.

- [ ] **Step 6: Push and open the draft pull request**

Push the branch and create a draft PR targeting `main` with the repository template sections:

```powershell
git push -u origin codex/issue-160-business-workspace-authorization
$prBody = @'
## Summary

- scope Business settings, schedule, stats, and request-triggered recurrence materialization to the authenticated tutor workspace
- reject foreign-workspace student schedule/billing reads and mutations without revealing resource existence
- add two-user database isolation coverage and route propagation coverage

Closes #160

## Validation

- focused `application.student-schedule-billing.test.ts`
- focused Business and student-content HTTP integration tests
- `pnpm --filter @esl-pipeline/batch-backend typecheck`
- `pnpm format`
- `pnpm run lint:repo-hygiene`
- `pnpm --silent run check:fast:agent`
- full local `pnpm check` intentionally omitted because broad validation is delegated to this draft PR's GitHub Actions checks

## Risk Notes

- authorization-sensitive SQL changes cover dashboard aggregates, student business mutations, legacy null-workspace compatibility, and recurrence side effects
- no schema, migration, public DTO, frontend, production-data, or deployment changes

## Checklist

- [x] Focused tests added before implementation
- [x] Behavior documentation updated
- [x] Local bounded validation completed
- [ ] Required GitHub Actions checks pass
- [ ] Integrated read-only security review is clean
'@
$prBody | gh pr create --draft `
  --base main `
  --head codex/issue-160-business-workspace-authorization `
  --title "fix(backend): enforce business workspace authorization" `
  --body-file - `
  --label release:patch
```

Before creation, remove any validation line for a command that did not actually run and add any
extra focused command that did run. Preserve the four required section names exactly.

- [ ] **Step 7: Verify metadata and delegate broad validation to GitHub Actions**

Run:

```powershell
gh pr view --json isDraft,labels,url,headRefName,baseRefName
$prNumber = gh pr view --json number --jq '.number'
gh pr checks $prNumber
```

Verify the PR is draft, targets `main`, and has exactly one label: `release:patch`. GitHub Actions
must run the broad static, integration, database/worker, and aggregate CI gates. Inspect exact failed
job logs and fix only evidence-backed failures. Do not reproduce the full aggregate lane locally on
this laptop.

- [ ] **Step 8: Mark ready only after CI and review are clean**

The PR can become ready when:

- focused local tests and `check:fast:agent` pass;
- the integrated reviewer has no unresolved critical or important findings;
- required GitHub Actions checks pass; and
- PR metadata and `release:patch` labeling are correct.

Do not merge or deploy without a separate user instruction.

---

## Final Verification Checklist

- [ ] `git diff origin/main...HEAD --check` passes.
- [ ] No scoped exported application function has an optional/default workspace parameter.
- [ ] No `/business/*` or student schedule/billing route accepts workspace input from the client.
- [ ] Every dashboard query uses the resolved workspace and explicit default-only null handling.
- [ ] Every student business operation authorizes the student before nested reads or writes.
- [ ] Foreign mutations leave every affected table unchanged.
- [ ] Request-triggered recurrence materialization cannot affect another workspace.
- [ ] Focused PostgreSQL and HTTP integration tests pass.
- [ ] Backend typecheck and `check:fast:agent` pass locally.
- [ ] Full local `pnpm check` was not run.
- [ ] Draft-PR GitHub Actions broad checks pass.
- [ ] Reviewer findings are resolved with follow-up from the same reviewer when needed.
- [ ] No migration, schema, contract, API DTO, frontend, #143, #144, production, or deployment change
      entered the diff.

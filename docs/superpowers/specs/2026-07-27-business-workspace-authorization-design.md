# Business Workspace Authorization Design

## Meta

- Date: 2026-07-27
- Status: approved for implementation planning
- Scope: cross-tutor authorization for business dashboard and student schedule/billing data
- Delivery: one focused patch pull request for GitHub issue #160
- Release: `release:patch`
- Related issues: #160; explicitly separate from product-truth audit #143 and UI redesign #144

## Summary

Each invited tutor receives a distinct workspace, owner membership, and workspace business-settings
row. The current business dashboard does not honor that ownership boundary: its authenticated routes
call application functions that use the historical default workspace. The related student
schedule/billing routes accept student identifiers without checking that the student belongs to the
authenticated tutor's workspace.

The repair makes workspace identity explicit from the HTTP boundary through every affected query.
It does not change business calculations, public DTOs, database schema, frontend behavior, or the
broader student authorization model. The patch begins with two-user/two-workspace regression tests
and fails closed for users without a membership or requests naming another workspace's student.

No production data inspection or mutation is part of this work.

## Confirmed Evidence

The following evidence was revalidated against `origin/main` at `ece7556e` before this design was
approved:

- invited registration creates a new workspace, an owner membership, and a
  `workspace_business_settings` row for each tutor;
- all four `/business/*` routes authenticate, but the three reads pass no user or workspace identity
  and the settings write uses the user ID only as `updated_by` audit metadata;
- `teacher-business-dashboard.ts` selects, aggregates, self-heals, and updates the fixed default
  workspace;
- dashboard schedule and stats reads invoke recurrence materialization without a workspace filter;
- the student schedule/billing read and its nine tutor-facing mutations look up the student by ID
  without an authenticated workspace predicate;
- `workspace-context.ts` already resolves a user's primary workspace from membership and neighboring
  student/profile routes use that resolver;
- RLS helper functions and policies exist, but migration `0007_rls_readiness_artifacts` intentionally
  did not enable RLS, and these application paths use ordinary database helpers; and
- existing HTTP tests mock the application layer while database-backed schedule/billing tests seed
  only the default workspace, so neither suite proves cross-tutor isolation.

The static data flow establishes the missing authorization boundary. Runtime exploitability and the
exact exposed result set remain hypotheses until the first failing two-tutor regression test
reproduces them in the local test database.

## Authorization Contract

### Workspace resolution

Every scoped HTTP request must:

1. require the existing authentication pre-handler;
2. read the authenticated user from the request;
3. call `resolvePrimaryWorkspaceIdForUser(authenticatedUser.id)`; and
4. pass the returned workspace ID as a required argument to the application function.

Authentication proves who the caller is. Membership resolution determines which business data the
caller may access. An audit actor ID must never substitute for an authorization workspace ID.

A user without a workspace membership receives the existing `403 workspace_required` response.
The repair does not add workspace selection or multi-workspace switching; the canonical primary
workspace resolver remains authoritative.

### Dashboard-wide business data

The following endpoints operate only on the resolved workspace:

- `GET /business/settings`;
- `PUT /business/settings`;
- `GET /business/schedule`; and
- `GET /business/stats`.

Their application entrypoints require `workspaceId` explicitly. Every settings, student, lesson,
recurrence, reminder, credit, and payment query used to construct a response must include that
workspace boundary. Returned `workspaceId` fields must equal the resolved workspace.

Settings self-healing may create a missing settings row only for the resolved, existing workspace.
Dashboard-triggered recurrence materialization must process only students in that workspace. Any
intentional all-workspace maintenance entrypoint remains separately named and cannot be called from
an authenticated dashboard request.

### Student-specific business data

The following routes require both the resolved workspace and the requested student ID:

- `GET /students/:id/surfaces/schedule-billing`;
- `PUT /students/:id/operations/lesson-plan`;
- `PUT /students/:id/operations/primary-lesson-recurrence`;
- `POST /students/:id/lessons`;
- `PATCH /students/:id/lessons/:lessonId`;
- `PUT /students/:id/operations/reminders/lesson-followup/:lessonId/hide`;
- `PUT /students/:id/operations/reminders/latest-hidden/undo`;
- `POST /students/:id/packages`;
- `POST /students/:id/credits/adjustments`; and
- `POST /students/:id/payments`.

The shared application lookup must return a student context only when the active student belongs to
the supplied workspace. All nested reads and writes remain downstream of that authorized context.
A student or lesson owned by another workspace returns the existing non-enumerating `404 not_found`
shape, and the attempted operation performs no write.

This patch does not authorize a general audit of unrelated student-memory, profile, assignment, or
content routes. Those surfaces remain outside issue #160.

### Legacy default-workspace compatibility

Historical rows may contain a null `workspace_id`. Existing compatibility treats those rows as
belonging to the fixed default workspace. The repair may preserve that behavior only with an
explicit predicate equivalent to:

```sql
row.workspace_id = $requested_workspace_id
OR (
  row.workspace_id IS NULL
  AND $requested_workspace_id = $default_workspace_id
)
```

Using `COALESCE(row.workspace_id, $requested_workspace_id) = $requested_workspace_id` is forbidden
because it would make every null-workspace row visible to every supplied workspace.

## Architecture

### Transport boundary

`business-routes.ts` follows the existing student-route pattern: obtain the authenticated user,
resolve the primary workspace, pass the workspace ID into the application call, and map
`WorkspaceContextError` to its canonical response.

The existing `resolveWorkspaceIdForRequest()` helper in `students-routes.ts` is reused for the ten
student business endpoints. Their schedule/billing error mapper gains `WorkspaceContextError`
handling so missing membership does not become an internal error.

No workspace ID is accepted from a request body, path, query string, or frontend state.

### Application boundary

Security-sensitive application signatures put the required `workspaceId` first so omitted context
becomes a TypeScript compile error. Representative signatures are:

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
getStudentScheduleBillingSurface(
  workspaceId: string,
  studentId: string,
): Promise<StudentScheduleBillingSurfaceResponse | null>;
```

The remaining student mutation functions follow the same ordering:
`workspaceId`, resource identifiers, request payload, then optional audit actor ID. Audit metadata
continues to record the authenticated user but does not participate in ownership selection.

`getStudentContext()` and `requireStudentContext()` become the single authorization choke point for
the scoped student business functions. Nested lesson lookups still constrain by both student and
lesson ID after the workspace-qualified student context has succeeded.

### Recurrence materialization

Dashboard reads call a workspace-specific recurrence materializer whose student selection includes
the requested workspace and the explicit default-workspace legacy rule. A separate all-workspace
entrypoint may remain for trusted maintenance use, but its name and call sites must make the broader
authority visible. An optional workspace parameter that silently means "all" is not acceptable.

## Error and Privacy Behavior

- unauthenticated requests retain the existing authentication response;
- authenticated users without membership receive `403 workspace_required`;
- foreign or absent student/lesson IDs receive the existing `404 not_found` response;
- validation failures retain their existing `400` shapes;
- no response reveals whether a foreign student or lesson exists;
- logs and test fixtures use generated IDs and synthetic names only; and
- no tutor, student, schedule, billing, or payment content from production is inspected or copied.

## Test Strategy

### Database-backed isolation tests first

Extend the serial PostgreSQL schedule/billing suite with two synthetic users, two workspaces, one
student per workspace, distinct settings, lessons, recurrence rules, reminders, credits, and
payments.

Before implementation, tests must fail while proving:

- each workspace's settings, schedule, stats, payments, credit alerts, and reminders exclude the
  other workspace;
- updating workspace A settings does not change workspace B settings or the default workspace;
- requesting workspace A with workspace B's student ID returns null or `not_found` for the read and
  every scoped mutation;
- rejected mutations leave lesson plans, recurrence rules, lessons, reminder preferences, credit
  events, packages, and payment records unchanged;
- dashboard recurrence materialization for workspace A does not create or advance workspace B
  lessons or recurrence state; and
- null-workspace legacy rows are visible from the default workspace but not from a non-default
  workspace.

The tests call the canonical membership resolver for both users so the fixture proves registration
ownership and application isolation compose correctly without requiring production-like tokens.

### Transport contract tests

The mocked HTTP integration suites prove each scoped route:

- resolves `test-user-id` through `resolvePrimaryWorkspaceIdForUser`;
- passes the resolved workspace ID in the correct application argument position;
- maps a missing membership to `403 workspace_required`; and
- preserves existing successful payloads and validation responses.

These tests complement rather than replace the real-query isolation suite.

### Validation boundary

Local validation is intentionally bounded for the resource-constrained development laptop:

1. focused PostgreSQL tests for `application.student-schedule-billing.test.ts`;
2. focused business and student HTTP integration tests;
3. backend typecheck/build if selected by the affected lane;
4. `pnpm format` and `pnpm run lint:repo-hygiene`; and
5. `pnpm --silent run check:fast:agent` as the normal local pre-push gate.

The full `pnpm check` must not run locally for this task. After focused local evidence passes, push
the implementation branch and open a draft pull request so GitHub Actions owns the broad CI,
database, worker, and integration validation. CI failures are diagnosed from the exact failing job;
the draft becomes ready only after required checks pass and review findings are resolved.

## Documentation and Contract Impact

Implementation updates:

- `packages/batch-backend/README.md` to state that business dashboard and student schedule/billing
  operations are scoped by the authenticated tutor's workspace membership; and
- `docs/backend-frontend/batch-backend-ssot.md` to record transport ownership of membership
  resolution and application ownership of workspace-qualified queries.

No public DTO, API path, environment variable, database migration, schema baseline, contract
version, business calculation, or frontend copy changes. The implementation plan does not update
#143 or #144 and does not redesign business features.

## Alternatives Considered

### Explicit workspace propagation through existing layers

Selected. It follows current neighboring route patterns, makes missing authorization context a
compile-time error, supports focused regression tests, and keeps the patch within issue #160.

### Enable and rely on PostgreSQL RLS

Rejected for this patch. RLS is intentionally only readiness infrastructure today. Enabling it
across business tables would require session-context propagation, policy design for every related
table and background worker, migration work, and a much broader regression surface.

### Introduce a global request-scoped workspace service

Rejected for this patch. A shared async context or repository abstraction could reduce repeated
arguments, but it would obscure the security dependency and widen the change across unrelated
application code. Explicit required parameters are safer for immediate containment.

## Delivery and Review

The primary agent owns all code, test, and documentation edits inline. One read-only `sol_reviewer`
gate reviews the integrated authorization context—tests, route propagation, SQL predicates, legacy
handling, and validation evidence—rather than reviewing each checklist item separately. Follow-up
review goes to the same reviewer when available.

The implementation is delivered in one focused draft PR from a branch based on current
`origin/main`, labeled `release:patch`. The draft PR is the broad-validation boundary; production
deployment or data repair is not authorized by this design.

## Non-Goals

- Product-truth or forecast semantics from #143.
- Calm Studio or other UI work from #144.
- Workspace selection or multi-workspace account UX.
- General student/profile/assignment authorization refactoring.
- Enabling RLS or adding database policies.
- Schema, migration, DTO, contract-version, or environment changes.
- Business calculation, label, currency, forecasting, reminder, or billing redesign.
- Production inspection, mutation, deployment, or recovery.
- Running the full `pnpm check` on the development laptop.

## Acceptance Criteria

1. Two-user/two-workspace database tests fail before the repair and pass afterward.
2. Every scoped route derives workspace identity only from authenticated membership.
3. Dashboard settings, schedule, stats, and request-triggered recurrence writes affect only the
   resolved workspace.
4. Foreign student and lesson IDs return non-enumerating not-found responses and perform no write
   across all ten student business endpoints.
5. Missing membership returns the canonical `workspace_required` response.
6. Legacy null-workspace rows remain confined to the historical default workspace.
7. Existing single-workspace payloads, validation behavior, paths, DTOs, and business calculations
   remain unchanged.
8. Backend behavior documentation states the workspace authorization boundary.
9. Focused local tests and `check:fast:agent` pass without running full `pnpm check` locally.
10. Required GitHub Actions checks pass on the draft PR before it is marked ready.

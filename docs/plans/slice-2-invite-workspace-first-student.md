# Slice 2: Invite Signup to Workspace to First Student

## Meta

- Audience: founder/operator, Codex, implementation agents.
- Status: active.
- Last Verified Against: 2026-07-16 repo state and v9.11.0 deployment evidence; 2026-07-14 manual
  main-flow smoke.
- Exit Trigger: archive or update after the Slice 2 implementation PR/hosted verification lands.
- Current Focus: implementation is shipped; capture one clean hosted invite acceptance -> default
  workspace/settings -> first student -> first assignment smoke before archiving.

## Goal

Allow an invited tutor to sign up, log in, receive a default workspace and default settings, create the first student, and reach the first assignment path without manual database work.

This slice starts only after Slice 1 private hosted environment passes or has a documented blocker that does not affect auth/workspace work.

## Current Phase

Hosted verification of the already-shipped invite-only tutor entry path.

Slice 2 covers the tutor entry path after the app has a private hosted environment.

## Non-Goals

Do not implement these in Slice 2:

- public marketing signup
- paid subscription/billing
- full organization/team management
- workspace switching UI beyond what is necessary
- advanced admin dashboard
- self-service invite request flow
- Google OAuth/social auth unless already trivial and explicitly selected
- full password reset email infrastructure if a simpler alpha-safe recovery path is chosen
- student portal
- Telegram bots
- broad onboarding tour system

Allowed exception: a non-goal may be touched only if it blocks invited tutor entry or first student creation.

## Existing Repo Facts to Verify

Before changing behavior, inspect:

```text
packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts
packages/batch-backend/src/domain/user-repository.ts
packages/batch-backend/src/domain/settings-repository.ts
packages/batch-backend/schema.sql
packages/batch-backend/src/infrastructure/migration-verify.ts
packages/batch-backend/src/transport/auth-middleware.ts
packages/batch-backend/src/transport/extended-routes/students-routes.ts
packages/batch-frontend/src/context/AuthContext.tsx
packages/batch-frontend/src/utils/api.ts or current API client files
packages/batch-frontend/src routes/pages for login/register/students/assignment sessions
```

Known current facts from repo inspection:

- Backend already has `POST /auth/register`.
- Current registration creates a user directly with `isActive: true`.
- Current registration accepts an optional role if provided by the request. This is unsafe for public/alpha signup unless restricted.
- `users` table currently has `role` and `is_active`, but not a richer account state enum.
- `workspaces`, `workspace_memberships`, and `workspace_business_settings` tables already exist.
- `user_settings` and `createDefaultSettings(userId)` already exist.
- Some business/student code uses a hard-coded default workspace fallback. Slice 2 should move new
  users toward explicit workspace ownership where practical.
- Current user/settings repository helpers open their own `withPgClient()` calls, so signup is not
  transaction-ready by just calling existing helpers in sequence.
- Student creation currently authenticates the route but does not derive a workspace from the
  authenticated user before calling `createStudentProfile()`.
- Business dashboard code still targets the hard-coded default workspace. Do not mistake default
  workspace fallback for tutor-safe workspace isolation.

## Product Decision for Slice 2

Use invite-only signup, not open public signup.

Minimum account states for alpha:

```text
invited
active
disabled
```

Implementation may represent these as a new column/table or as an invite table plus existing `users.is_active`, but the behavior must be explicit and documented.

Recommended simple alpha model:

```text
alpha_invites
  id uuid primary key
  email text not null
  email_normalized text not null
  token_hash text not null
  status text not null check in ('pending', 'accepted', 'revoked', 'expired')
  invited_by_user_id uuid null references users(id)
  accepted_user_id uuid null references users(id)
  expires_at timestamptz not null
  created_at timestamptz not null default now()
  accepted_at timestamptz null
  revoked_at timestamptz null
```

User account status can remain:

```text
users.is_active = true/false
users.role = admin/user/viewer
```

But docs and code must make the lifecycle clear:

```text
invited = valid pending invite exists
active = user exists and is_active=true
revoked/disabled = invite revoked or user is_active=false
```

If Codex recommends a different schema, it must state why and include migration/rollback.

## Required Behavior

### Registration

Invited tutor registration must:

- require a valid invite token or equivalent controlled signup mechanism
- normalize email consistently
- ensure token email matches registration email, unless explicitly decided otherwise
- reject revoked/expired/used invites
- create user with safe default role `user`
- ignore or reject client-provided role for normal registration
- create default user settings
- create default workspace
- create owner workspace membership
- create default workspace business settings
- mark invite accepted
- return a login-ready/auth-ready response consistent with current frontend flow

Open public registration must be disabled or controlled for alpha.

### Login

Login must:

- reject inactive/disabled users
- issue current auth tokens/cookies according to existing auth design
- preserve existing authenticated API behavior

### Workspace Creation

Default workspace creation must be automatic during accepted signup.

Suggested default workspace name:

```text
<email local part>'s workspace
```

or:

```text
My ESL workspace
```

Do not overbuild naming customization in Slice 2.

### First Student Path

After signup/login, a tutor with no students should have a clear path to create the first student.

Minimum acceptable behavior:

- authenticated tutor can open students page/dashboard
- empty state explains that no students exist yet
- create student form works
- created student is associated with the tutor's workspace where current schema supports it
- tutor can reach first assignment entry path from student or dashboard

Do not build a full onboarding product. Use the smallest UI that prevents “what do I do next?” confusion.

## Required Deliverables

### 1. Account lifecycle doc

Create or update:

```text
docs/operations/closed-alpha-account-lifecycle.md
```

Must document:

- invite creation path
- invite states
- user states
- how signup is controlled
- how to disable a user
- how to revoke an invite
- how to manually recover a user during alpha
- security notes

### 2. Backend invite/signup implementation

Expected backend work:

- migration for invite table or chosen equivalent
- repository/service for invites
- update registration route to require invite
- role escalation blocked from public registration
- user, settings, workspace, membership, workspace settings created transactionally, which may
  require transaction-aware repository helpers rather than the current `withPgClient()` wrappers
- tests for success and failure cases

Important:

Use a DB transaction for signup side effects. Do not create user without workspace/settings if later steps fail.

### 3. Frontend signup flow

Expected frontend work:

- route/page supports invite token input, likely from URL
- registration form sends token
- failed invite states show clear messages
- after signup, tutor lands somewhere useful
- no-students empty state routes to create first student

### 4. First student verification

Expected backend/frontend behavior:

- new tutor can create first student
- student is associated with the user's workspace where the current schema supports it
- student appears only for that tutor/workspace
- tutor can start assignment flow
- `/config/students`, `/students/summary`, and student CRUD/list/detail/archive/restore routes are
  scoped to the authenticated user's primary workspace.

Important verification point:

Creating the first student is not enough if list/detail/update routes still read by raw student ID
without checking workspace membership. Slice 2 should either add the smallest user-workspace context
needed for the first-student path or stop with a documented workspace-boundary blocker for Slice 4.

### 5. Tests

Backend tests must cover:

- signup fails without invite
- signup fails with expired invite
- signup fails with revoked invite
- signup fails when invite email does not match registration email, if email matching is selected
- signup ignores/rejects client-provided admin role
- signup success creates user
- signup success creates default settings
- signup success creates workspace
- signup success creates owner membership
- signup success creates workspace business settings
- signup success marks invite accepted
- login rejects inactive user

Frontend tests should cover:

- invite token is read from URL or entered manually
- failed invite error is visible
- successful signup routes to first useful screen
- no-student empty state displays create-student action

Integration/manual tests must cover:

- invited tutor signs up without manual DB intervention
- invited tutor logs in
- tutor has workspace
- tutor creates first student
- tutor reaches first assignment path

## Suggested Slice 2 Implementation Steps

### Step A: inspect current auth and workspace behavior

Codex should report:

```text
- current auth/register/login routes
- current frontend registration flow
- current user settings creation behavior
- current workspace tables and helper functions
- whether workspace creation helpers already exist
- whether students are currently workspace-scoped in create/list routes
- whether student detail/update/archive routes enforce the authenticated user's workspace
- smallest safe invite-only signup design
```

### Step B: decide representation

Use the recommended `alpha_invites` table unless Codex finds an existing invite/account-state mechanism.

Record the decision in:

```text
docs/alpha-deployment-decisions.md
```

### Step C: implement backend transaction

Pseudo-flow:

```text
begin transaction
  validate invite token
  lock invite row
  create user with role=user and is_active=true
  create default user settings
  create workspace
  create workspace_membership role=owner
  create workspace_business_settings
  mark invite accepted
commit
```

If any step fails, rollback all signup side effects.

### Step D: implement frontend path

Keep it small:

```text
/invite/:token or /register?invite=...
register form
post token + email + password
show useful error
redirect to dashboard/students
empty state -> create first student
```

### Step E: verify hosted after Slice 1

Run the flow in the hosted environment, not only locally.

## Migration and Data Safety

Before applying migrations to hosted alpha DB:

1. Run S3 backup.
2. Verify backup exists remotely.
3. Apply migration.
4. Run migration verify command.
5. Test signup flow.

Do not run risky migrations without a rollback path.

## Commands to Verify

Codex must adjust these to the exact implementation:

```bash
Confirm successful hosted PR CI and `CI gate` for the target commit.
pnpm --filter @esl-pipeline/batch-backend test:db:migrations
pnpm --filter @esl-pipeline/batch-backend test:integration:http
pnpm --filter @esl-pipeline/batch-frontend test:unit
pnpm docker:prod
pnpm docker:prod:ps
```

If migration touches DB-backed behavior:

```bash
pnpm test:backend:db:worker
```

## Manual Verification Script

Use this as the final Slice 2 checklist:

```text
1. Operator creates invite for tutor email.
2. Tutor opens invite link.
3. Tutor creates account.
4. Tutor logs in or is logged in after signup.
5. Tutor lands in app without manual DB edit.
6. Tutor has exactly one default workspace.
7. Tutor has owner membership in that workspace.
8. Tutor has default user settings.
9. Tutor sees no-students empty state.
10. Tutor creates first student.
11. Student appears in tutor UI.
12. Tutor can start first assignment flow.
13. Non-invited signup attempt fails.
14. Client cannot self-register as admin.
15. Disabled user cannot log in.
```

## Completion Evidence

Slice 2 is done only when this is true:

```text
- account lifecycle is documented
- invite-only or controlled signup is implemented
- signup requires no manual DB intervention
- default workspace is created during signup
- default tutor settings are created during signup
- first student can be created
- first assignment entry path is reachable
- normal tutors cannot self-assign admin role
- tests cover invite/account/workspace creation behavior
- hosted manual verification passes
- auth/invite rate limiting or equivalent abuse protection is added before broader alpha
```

## Stop Conditions

Stop and report instead of expanding scope if:

- current schema cannot support safe workspace ownership without a larger workspace boundary audit
- signup cannot be made transactional without risky refactor
- frontend auth flow is too entangled to patch safely in one slice
- role escalation risk cannot be closed cleanly
- password reset/recovery becomes a hard blocker and requires product decision
- implementation would accidentally start building public SaaS signup instead of closed alpha invite signup

# Closed Alpha Account Lifecycle

## Meta

- Audience: founder/operator and implementation agents.
- Status: active for closed-alpha Slice 2.
- Related plan: `docs/plans/slice-2-invite-workspace-first-student.md`.

## Lifecycle

Closed alpha signup is invite-only.

```text
invited = pending alpha_invites row exists
active = user exists with users.is_active=true
disabled = user exists with users.is_active=false
revoked = invite status is revoked
expired = invite status is expired or expires_at has passed
```

Normal alpha signup creates:

```text
users.role = user
workspace_memberships.role = owner
```

Client-supplied roles are ignored during public registration.

## Operator Commands

Run inside the production backend container:

```bash
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/alpha-invites.js create --email tutor@example.com --expires-days 14 --app-url https://app.example.com
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/alpha-invites.js list
docker compose -p esl-pipeline-prod -f docker-compose.prod.yml exec batch-backend node dist/tools/alpha-invites.js revoke --email tutor@example.com
```

The `create` command prints the raw token exactly once. Store only the invite URL sent to the tutor.
Do not paste raw tokens into shared logs.

The `list` command never prints raw tokens or token hashes.

## Invite URLs

Prefer URL fragments so invite tokens are not sent to the server:

```text
https://app.example.com/#invite=<token>
```

If the router changes to hash routing later, use a compatible fragment such as:

```text
https://app.example.com/#/register?invite=<token>
```

## Registration Behavior

`POST /auth/register` requires:

```text
email
password
inviteToken
```

The backend rejects missing, invalid, expired, revoked, already accepted, or email-mismatched invites.
Error messages should be useful but should not expose unnecessary invite enumeration details.

Signup is transactional. If user settings, workspace, owner membership, workspace business settings,
or invite acceptance fails, no partial signup should remain.

## Disable and Recovery

Disable a user by setting `users.is_active=false`. Login rejects inactive users.

Alpha recovery is manual:

1. Confirm the tutor email and intended workspace.
2. Inspect `users`, `workspace_memberships`, `user_settings`, and `alpha_invites`.
3. If signup partially failed, prefer deleting the failed rows and issuing a fresh invite.
4. Do not manually mark an invite accepted unless the user/workspace/settings rows are confirmed.

Before running recovery on hosted data, take a Postgres backup and verify the backup key.

## Gates

- Plain HTTP is only acceptable for founder/operator rehearsal.
- Do not ask real tutors to register, log in, or submit lesson/student data until HTTPS is configured.
- Registration and invite validation currently do not have a dedicated auth-route rate limit. Add
  auth/invite abuse protection before broader alpha.
- After Slice 2, invite at most one real tutor unless cross-workspace tests cover the active
  assignment flow: assignment sessions, recordings/transcripts, drafts, jobs, published artifacts,
  student memory/context, and any lesson/payment surfaces shown in the UI.

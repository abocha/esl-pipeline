# Plan: Add `/student`, `/jobs`, `/today`, and `/botstatus` to Telegram Ops Bot

## Summary
Implement four operator-focused commands in the Telegram bot, with the minimum backend additions needed to keep them genuinely useful:

- `/student <name-or-id>`: resolve a student by name/UUID/prefix, show a compact student status view, and disambiguate ambiguous names with inline buttons.
- `/jobs <filter>`: structured job query command with a small, predictable filter language and a useful default when no filter is provided.
- `/today`: UTC-day dashboard for all jobs, combining counts with short “attention” lists.
- `/botstatus`: bot-local diagnostic view that combines runtime/config state with a live backend reachability check.

Keep the feature set intentionally narrow in v1:
- No new env vars.
- No natural-language query parsing.
- No title/preset search in `/jobs` v1.
- Only `/student` gets new guided callback support; the other three remain slash-command-first.

## Implementation Changes

### 1. Backend/API surface
Add or extend only the APIs the bot actually needs.

- Add `GET /admin/jobs/summary` in batch-backend, admin-authenticated, mirroring `/user/jobs/summary` but without user scoping.
  - Query params: `from`, `to`.
  - Response: existing `JobSummaryResponse`.
- Reuse existing endpoints as-is for student and job lookup:
  - `GET /admin/jobs`
  - `GET /students?q=...`
  - `GET /students/:id`
- Add shared contract types for the student search route so the bot client stays typed.
  - Minimal exported DTO/response is enough: `StudentProfileDto` and `StudentProfileListResponse`.
  - Do not add timeline contracts; `/student` will use student search + admin jobs, not timeline.

### 2. Bot backend client and command context
Extend the bot client and runtime context just enough to support the new commands.

- Extend `BackendClient`/`HttpBackendClient` with:
  - `listJobs(params)`
  - `getAdminJobSummary(params)`
  - `searchStudents(query, limit?)`
- Add a small runtime snapshot provider to `CommandContext` for `/botstatus`.
  - Snapshot fields:
    - `initialized: boolean`
    - `botUsername: string | null`
    - `mode: 'polling' | 'webhook'`
    - `leadershipState: 'leader' | 'follower' | 'unknown' | 'not_applicable'`
  - Runner owns this snapshot and updates it from existing initialization and leader-election flow.
- No persistent metrics store or extra database state for `/botstatus` in v1.

### 3. Command behaviors

#### `/student <name-or-id>`
Exact behavior:
- Missing arg: send usage with examples.
- Resolution flow:
  - If the input is an exact UUID, query `/students?q=<input>` and prefer exact ID match.
  - Otherwise query `/students?q=<input>&limit=10`.
  - Match priority:
    1. exact ID
    2. exact student name case-insensitive
    3. partial matches from the backend search result
- Resolution outcomes:
  - `0 matches`: “No student matched” message with examples.
  - `1 match`: render student detail view.
  - `>1 matches`: render a disambiguation message with top 5 candidates and inline buttons.
    - Button text: `Name · short-id`
    - Add new guided callback kind: `student`
- Student detail view:
  - Header line with `Student Name (short-id)`
  - Summary lines:
    - latest job state
    - latest job timestamp in UTC
    - latest assignment title when extractable from inline markdown only
  - Recent jobs section:
    - latest 5 jobs from `/admin/jobs?studentId=<id>&order=desc&limit=5`
    - each row shows state, UTC timestamp, preset, short job ID
  - Inline buttons:
    - `Latest Job` for the newest job
    - `Share Latest` only if newest job state is `succeeded`
    - `Refresh` using the `student` callback
- Do not call the student timeline endpoint in v1.

#### `/jobs <filter>`
Exact default:
- `/jobs` with no filter returns the latest 10 jobs across all states.

Supported filter grammar only:
- `state:<queued|running|awaiting_approval|succeeded|failed[,more]>`
- `student:<quoted name or id/prefix>`
- `since:<today|yesterday|YYYY-MM-DD>`
- `before:<today|yesterday|YYYY-MM-DD>`
- `limit:<1-20>`
- `order:<asc|desc>`

Parsing rules:
- Token format is strict `key:value`.
- Quoted values are required for names with spaces, e.g. `student:"Mary Jane"`.
- If there are no structured tokens and raw text is present, treat the whole input as a student query term.
- Unknown keys or malformed values return a usage/help message, not a partial parse.
- `since`/`before` are interpreted in UTC.
  - `today` = current UTC day start.
  - `yesterday` = previous UTC day start.
  - `before:<date>` is exclusive at UTC midnight of that date.

Student filter handling:
- Resolve `student:` through `/students?q=...`.
- If exactly one match, rewrite to `studentId`.
- If multiple matches, return a short candidate list and tell the operator to rerun with an exact student ID.
- No buttons for this ambiguity case in v1.

Jobs result view:
- Header with normalized filters and `Showing X of Y`.
- List top `limit` jobs, each with:
  - student name + short student ID
  - state
  - UTC timestamp
  - preset
  - job ID
- Include top 5 inline `Job` buttons using existing job callback kind.
- No refresh callback in v1 because arbitrary filter state is not encoded into callbacks.

#### `/today`
Definition:
- “Today” means current UTC calendar day: `[00:00 UTC, now)`.

Data flow:
- Call `/admin/jobs/summary?from=<utc-start>&to=<now>`.
- Call `/admin/jobs` three times for short detail lists:
  - `state=failed`, `limit=3`
  - `state=running`, `limit=3`
  - `state=succeeded`, `limit=5`

Output:
- Header: `Today · YYYY-MM-DD UTC`
- Counts:
  - total
  - succeeded
  - failed
  - running
  - queued
  - awaiting approval
- Attention section only if any of `failed`, `running`, or `awaiting approval` are non-zero.
- Recent finished section from succeeded list.
- Recent failures section if any.
- Running now section if any.
- Footer with exact follow-up commands:
  - `/jobs state:failed since:today`
  - `/jobs state:running`
- No inline callbacks in v1.

#### `/botstatus`
Goal:
- Diagnose the bot itself, not replace `/status`.

Data sources:
- Runtime snapshot from the runner.
- Live backend check via `getOpsStatus()`.
- Topic routing inspection via `topicRouter.resolveThreadId()` for `ops`, `jobs`, `alerts`.
- Static config values already in `CommandContext.config`.

Output:
- Overall state:
  - `healthy` if runtime is initialized and backend check succeeds
  - `degraded` otherwise
- Sections:
  - Bot:
    - bot username
    - mode
    - action commands enabled vs read-only
  - Polling/Webhook:
    - polling: poll interval, timeout, leader election enabled, current leader role
    - webhook: host, port, path, secret-token configured yes/no
  - Backend:
    - reachable/auth OK or error message
  - Topics:
    - resolved thread IDs for `ops`, `jobs`, `alerts`
    - note when a domain resolves via default thread or remains unresolved
- Warnings section only when something is degraded.
- No inline callbacks in v1.

### 4. Formatter and callback work
- Add new formatter functions for:
  - student ambiguity list
  - student detail view
  - jobs query result view
  - today dashboard
  - botstatus report
- Reuse existing UTC formatter and student identity formatting.
- Add exactly one new guided callback kind:
  - `student`
- Do not add callback kinds for `/jobs`, `/today`, or `/botstatus`.

## Test Plan
Add focused coverage in bot and backend packages.

- Backend
  - `GET /admin/jobs/summary` returns the same shape as `/user/jobs/summary` without user scoping.
  - Validation errors for bad `from`/`to` values.
- Bot backend client
  - `searchStudents()` hits `/students?q=...`.
  - `listJobs()` serializes state/date/order/limit correctly.
  - `getAdminJobSummary()` hits `/admin/jobs/summary`.
- Bot command tests
  - `/student`:
    - missing arg
    - zero matches
    - one exact match
    - multiple matches renders candidate buttons
    - student detail view includes latest job and refresh button
  - `/jobs`:
    - empty args defaults to recent 10
    - valid token parsing
    - quoted student name parsing
    - bad token errors
    - ambiguous student filter returns candidate list
  - `/today`:
    - uses UTC day range
    - hides empty sections
    - shows follow-up command hints
  - `/botstatus`:
    - healthy backend path
    - backend failure path
    - polling leader/follower/unknown cases
    - webhook mode formatting
- Runner/callback tests
  - new `student` callback opens student detail view from disambiguation buttons
- Formatter tests
  - stable output for each new view
  - UTC timestamps remain explicit and non-localized

## Assumptions and Defaults
- UTC remains the canonical display and query boundary for all four commands.
- `/jobs` v1 supports only `state`, `student`, `since`, `before`, `limit`, and `order`.
- `/jobs` does not support preset/title/full-text markdown search in v1.
- `/student` uses student search + admin jobs only; it does not use the student timeline endpoint.
- `/botstatus` is live-diagnostic and config-aware, but it does not persist historical health or expose a large internal debug dump.
- No new environment variables or operator setup steps are introduced.

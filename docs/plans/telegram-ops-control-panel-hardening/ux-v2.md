# V2 Telegram Ops Bot UX: Summary → Browse → Detail → Share

## Summary
Redesign the bot into one navigable ops console where summaries lead to filtered lists, lists lead to job detail, and job detail leads to a single sharing action. Add `/students` as the top-level student browser, make `/jobs` the canonical list engine behind all job browsing, and retire `/links` from the visible UX in favor of `/share`.

Chosen defaults:
- `/students` is paged
- `/students` defaults to recent activity first
- `/jobs` uses guided navigation plus soft parsing for simple typed input
- `/links` is retired from the UI surface and replaced by `/share`

## Key Changes

### 1. Information architecture and navigation model
Adopt one interaction model across the bot:
- Summary: `/today`, `/botstatus`
- Context: `/student <name-or-id>`, `/students`
- Browse: `/jobs`, `/finished`
- Detail: `/job <jobId>`
- Action: `/share <jobId>`

Apply this consistently:
- `/finished` becomes a preset jobs list view, not a separate visual pattern
- `/today` buttons open filtered jobs lists
- `/student` buttons open student-scoped jobs lists
- `/students` opens a paged student browser, then student-scoped jobs, then job detail, then share
- `/job` exposes one primary action: `Share`

Use context-bearing titles everywhere:
- `Today · YYYY-MM-DD UTC`
- `Jobs · Failed · Today`
- `Jobs · Margarita (72444fdf) · Recent`
- `Students · Page 1`
- `Job · SUCCEEDED`

### 2. `/students` as the new student browser
Add `/students` as the main top-level browse entry for people.

Behavior:
- Source is `GET /students/summary`
- Default sort is recent activity first using `lastLessonAt` descending, nulls last
- Page size is fixed in v1: 10 students
- Message body shows:
  - student name
  - short student ID
  - last lesson UTC time if present
  - pending drafts count if non-zero
- Buttons:
  - one button per student: `Name · short-id`
  - bottom row: `Prev`, `Next`, `Home`
- Student button opens the same student detail surface as `/student <name-or-id>`

New callback/navigation state:
- `students_home`
- `students_page:<offset>`
- `student:<id>`
- `jobs_view:<serialized-filter-state>`

### 3. `/student` and `/jobs` become fully intertwined
Keep `/student <name-or-id>` as direct lookup, but make it a launcher into the jobs browser.

`/student` behavior:
- Header card with latest state, latest UTC time, latest homework, recent jobs snapshot
- Buttons:
  - `Recent Jobs`
  - `Failed`
  - `Succeeded`
  - `Latest Job`
  - `Share Latest`
  - `Refresh`
  - `Home`
- `Recent Jobs`, `Failed`, and `Succeeded` all open student-scoped `/jobs` views

`/jobs` behavior:
- It becomes the canonical filtered list renderer for all job lists, whether entered directly or reached by buttons
- Bare `/jobs` opens `Browse Jobs`:
  - latest 10 jobs
  - quick filter buttons: `Failed`, `Running`, `Succeeded`, `Today`, `Home`
  - short examples at the bottom
- Soft parsing for direct typed use:
  - `/jobs failed` → `state:failed`
  - `/jobs running today` → `state:running since:today`
  - `/jobs Margarita` → student query
  - `/jobs failed Margarita` → state + student query
- Keep structured filters as the exact syntax layer:
  - `state:`
  - `student:`
  - `since:`
  - `before:`
  - `limit:`
  - `order:`
- Parsing precedence:
  - explicit `key:value` tokens win
  - if no structured tokens, parse recognized keywords (`failed`, `running`, `succeeded`, `today`, `yesterday`) and treat remaining text as the student query
- Always echo normalized interpretation at the top

Navigation/buttons in jobs lists:
- top 5 job buttons
- refinement chips depending on scope:
  - global: `Failed`, `Running`, `Succeeded`, `Today`, `Home`
  - student-scoped: `Recent`, `Failed`, `Succeeded`, `Back to Student`, `Home`
  - today-scoped: `Failed`, `Running`, `Awaiting`, `Finished`, `Back to Today`

### 4. `/today`, `/finished`, `/job`, and `/share` align to the shared flow
`/today`:
- stays the dashboard entry
- buttons:
  - `Failed`
  - `Running`
  - `Awaiting`
  - `Finished`
  - `All Today`
- every button opens a `/jobs` view with preserved title context

`/finished`:
- becomes a named preset over the shared jobs list renderer
- title becomes `Jobs · Recent Finished`

`/job`:
- remains the detail view
- buttons:
  - `Share`
  - `Back`
  - `Home`
- `Back` returns to the originating list when available from callback state; slash-command entry falls back to `Finished` or `Home`

`/share`:
- becomes the only visible action command for sending assignment/audio output
- all action entrypoints point to `/share`
- copy and help text should frame it as “send the student package”

### 5. Retire `/links` in favor of `/share`
Retire `/links` from the UX surface.

Behavior change:
- remove `/links` from command metadata, help, and guided/home surfaces
- remove `Links` button from `/job`
- remove `job_links` callback from visible keyboards and navigation flows
- all former `Links` paths become `Share`

Compatibility policy:
- keep `/links` as a hidden compatibility alias for one release cycle only
- alias behavior:
  - do not advertise it anywhere
  - when used directly, execute the `/share` flow
  - prepend one short deprecation line: `Use /share going forward.`
- after the compatibility window, remove the alias and `job_links` callback decode path entirely

### 6. API, client, and formatter additions
Public or typed interface additions needed:
- Bot backend client:
  - add `listStudentSummaries({ limit, offset, order })`
  - keep `searchStudents()` for `/student` and `/jobs student query`
- Reuse existing backend `GET /students/summary`
- Add callback payload support for:
  - student browser paging
  - jobs preset/filter views with enough serialized state for refresh/back/refinement
- Unify jobs-list formatting into one formatter used by:
  - `/jobs`
  - `/finished`
  - `/today` drill-downs
  - `/student` drill-downs
- Add student-browser formatter for `/students`
- Keep UTC display as `YYYY-MM-DD HH:mm UTC`

## Test Plan
Core command tests:
- `/students` first page renders recent-activity-ordered students with paging buttons
- `/students` next/prev callbacks page correctly
- `/students` student button opens the same detail surface as `/student`
- `/student` buttons open scoped jobs lists
- bare `/jobs` renders browse view plus examples and quick filters
- `/jobs` soft parsing handles:
  - single state
  - state + today
  - plain student name
  - state + student name
- `/finished` renders through the shared jobs list formatter
- `/today` drill-down buttons open the right filtered jobs views
- `/job` exposes `Share` but not `Links`
- `/links` direct invocation routes to `/share` and shows deprecation copy during the compatibility window

Callback/navigation tests:
- back navigation returns to the originating list context
- student-scoped jobs refinement stays within that student
- today-scoped jobs refinement stays within today
- paging state for `/students` survives callback rendering/edit fallback paths
- old `job_links` callback data, if still decoded during compatibility, resolves to the share action path

Formatter tests:
- consistent title formats for all list contexts
- student browser rows show name, short ID, and recent-activity metadata
- jobs list rows stay visually consistent across `/jobs`, `/finished`, and drill-downs
- deprecated `/links` alias message is only shown on direct alias usage, not on `/share`

Client/integration tests:
- `listStudentSummaries()` hits `/students/summary` with pagination/order params
- existing `searchStudents()` remains unchanged for lookup flows

## Assumptions and defaults
- `/students` uses `/students/summary`, because recent activity is the desired default ordering and that endpoint already carries operational signal
- Page size for `/students` is 10
- Recent activity means `lastLessonAt` descending, nulls last
- `/jobs` remains deterministic and does not become free-form natural language search
- Structured filters remain the exact layer; soft parsing is only for a small fixed set of common words
- UTC remains the canonical display and time-boundary convention everywhere
- `/links` is retired from the visible UX immediately, but a hidden alias remains for one release cycle to reduce operator disruption

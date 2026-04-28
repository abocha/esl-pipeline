# Phase 6: Shared Student Masthead And Density System

## Summary

This phase converts the latest student-area design insight into an implementation slice.

Implementation status: the first shell implementation is in place on the current branch. The shared
masthead, route-aware body density, page-local identity removal, honest `Schedule & Billing`
placeholders, and directory identity continuity have been implemented and covered by targeted
frontend tests. Browser visual verification remains a follow-up, and Phase 7 owns the next unified
design-language pass.

This phase was created because the first page implementations left too much student identity inside
individual pages. `Overview`, `Learning`, and `History` each reintroduced a page-local hero or
identity block below the global app header and the earlier `StudentAreaShell`. That created three
stacked heading systems:

1. product-level navigation in `MinimalShell`
2. contextual student navigation in `StudentAreaShell`
3. page-local student identity heroes in each student page

The right fix was not to narrow one page or polish one hero. The student area needed a real shared
student masthead that owns identity, local navigation, and page-density framing for every student
subpage.

## Assessment Of The New Recommendation

The recommendation in `tmp/plans/student-are_redesign2.md` should be accepted as a cross-cutting
follow-up to the original student-area redesign plans.

It is especially strong because it:

1. preserves the original four-page architecture from
   [`README.md`](README.md)
2. strengthens the visual locks in
   [`overview-page-design-lock.md`](overview-page-design-lock.md) and
   [`history-page-design-lock.md`](history-page-design-lock.md)
3. removes duplicated identity surfaces instead of tuning duplicated surfaces independently
4. gives future `Schedule & Billing` a ready-made page frame before that page becomes complex
5. explains why `History` feels too empty without making the whole student area artificially narrow

The only adjustment is sequencing: this should become a shell-level implementation phase that runs
before further page polish. If the team continues polishing `Overview`, `Learning`, and `History`
inside their current local hero structures, the duplicated shell problem will keep reappearing.

## Product Decision

`StudentAreaShell` should become the shared student masthead for the full student area.

It should own:

1. back link or breadcrumb to `Students`
2. initials avatar now
3. Telegram avatar slot later
4. student name
5. short student ID
6. one short contextual line for the active page
7. shared tabs for `Overview`, `Learning`, `History`, and `Schedule & Billing`
8. body density selection for each subpage

Individual pages should stop owning:

1. repeated student portraits
2. repeated student names
3. repeated short IDs
4. repeated `Back to all students` links
5. broad page heroes that delay access to actual work

Individual pages may still own:

1. page-specific explanatory panels
2. page-specific status cards
3. page-specific filters and controls
4. page-specific empty states
5. page-specific body layout

## Target Page Model

The target structure is:

1. `MinimalShell`
   - product-level frame
   - `Minimal Flow` and `Students`
2. `StudentAreaShell`
   - student masthead
   - student-area tabs
   - active-page summary
   - density wrapper
3. student subpage
   - real page content
   - no duplicated identity hero

The mental model should become:

`All students` -> `Student masthead shell` -> `Student subpages`

not:

`All students` -> `Student area card` -> `Another page hero` -> `Actual content`

## Density Variants

Do not force every student page into one shared max width.

The masthead can stay wide and centered, while the body uses a density variant chosen by route.

Recommended variants:

1. `overview`
   - wide
   - supports balanced summary cards and an operations rail
2. `learning`
   - form-wide
   - supports structured profile forms, revision state, memory cards, and candidate review
3. `history`
   - reading
   - supports an editorial timeline column without stretched empty space
4. `schedule-billing`
   - operations
   - supports ledgers, credits, reminders, invoices, and planning controls

Initial CSS targets:

1. masthead max width: roughly `1120px`
2. overview body max width: roughly `1120px`
3. learning body max width: roughly `1180px`
4. history body max width: roughly `860px` to `940px`
5. schedule-billing body max width: roughly `1040px`

These are target ranges, not contract values. The implementation should verify the actual feel in a
browser and adjust within these ranges.

## Implementation Plan

### Task 1: Add the shared masthead contract to `StudentAreaShell`

**Files:**

1. modify `packages/batch-frontend/src/ui/students/StudentAreaShell.tsx`
2. add or update `packages/batch-frontend/src/ui/students/StudentAreaShell.test.tsx`

Steps:

1. Add a route-to-page metadata map in `StudentAreaShell.tsx`.
2. Derive the active page from the current location pathname.
3. Render a quiet editorial masthead instead of the current generic card.
4. Include a single `Back to all students` link.
5. Render an initials avatar using the existing `getStudentInitials` helper.
6. Render the student name and `formatStudentShortId(student.id)`.
7. Render one active-page summary line from the metadata map.
8. Keep the existing tab order:
   - `Overview`
   - `Learning`
   - `History`
   - `Schedule & Billing`
9. Wrap `<Outlet />` in a body element with a density class from the metadata map.
10. Keep the outlet context shape unchanged:

- `student`
- `studentId`
- `studentLoading`
- `studentError`
- `refreshStudent`

Recommended page metadata:

```ts
type StudentAreaPageKey = 'overview' | 'learning' | 'history' | 'schedule-billing';

interface StudentAreaPageMeta {
  label: string;
  summary: string;
  density: 'overview' | 'learning' | 'reading' | 'operations';
}

const STUDENT_AREA_PAGE_META: Record<StudentAreaPageKey, StudentAreaPageMeta> = {
  overview: {
    label: 'Overview',
    summary: 'A calm control surface for the current learning relationship.',
    density: 'overview',
  },
  learning: {
    label: 'Learning',
    summary: 'The canonical pedagogical home for profile truth and memory signals.',
    density: 'learning',
  },
  history: {
    label: 'History',
    summary: 'A chronological teaching ledger for lessons, materials, and profile changes.',
    density: 'reading',
  },
  'schedule-billing': {
    label: 'Schedule & Billing',
    summary: 'The future home for lessons, credits, reminders, invoices, and calendar state.',
    density: 'operations',
  },
};
```

Acceptance checks:

1. `StudentAreaShell` contains the only full student identity masthead inside the routed student
   area.
2. The outlet context remains backward-compatible.
3. Existing page routes still resolve.
4. Tests assert the masthead renders the student name, short ID, back link, and active tab.

### Task 2: Remove duplicated identity heroes from `Overview`

**Files:**

1. modify `packages/batch-frontend/src/ui/students/StudentOverviewPage.tsx`
2. update `packages/batch-frontend/src/ui/students/StudentOverviewPage.test.tsx`

Steps:

1. Remove the page-local `Back to all students` link from `StudentOverviewPage`.
2. Remove the page-local portrait, name, and short-ID hero from `StudentOverviewPage`.
3. Preserve the profile status link, but move it into the overview body as the first calm status
   surface.
4. Preserve the operations rail.
5. Keep the learner snapshot, current focus, attention cue, and recent activity preview.
6. Ensure `Overview` starts with useful control-surface content instead of another identity block.
7. Keep the non-readable pending canvas behavior unless Task 1 adds shell-level pending coverage
   that makes the local skeleton redundant.

Acceptance checks:

1. `Overview` does not render a second student name heading below the masthead.
2. The profile status link still routes to `Learning`.
3. The operations rows still route to `Schedule & Billing`.
4. Existing overview data-loading tests still pass after assertion updates.

### Task 3: Remove duplicated identity heroes from `History`

**Files:**

1. modify `packages/batch-frontend/src/ui/students/StudentHistoryPage.tsx`
2. update `packages/batch-frontend/src/ui/students/StudentHistoryPage.test.tsx`

Steps:

1. Remove the page-local `Back to all students` link from `StudentHistoryPage`.
2. Remove the page-local portrait, name, and short-ID hero from `StudentHistoryPage`.
3. Keep `About this history`, but convert it from a hero-side aside into the first page-specific
   explanatory panel below the masthead.
4. Keep event filters below the explanation panel.
5. Keep the reverse-chronological timeline and grouped date model.
6. Apply the shell `reading` density to make the timeline feel like an editorial ledger rather than
   a stretched dashboard.

Acceptance checks:

1. `History` does not duplicate the student masthead.
2. `About this history` remains visible and teacher-readable.
3. Timeline filters remain reachable before the first timeline group.
4. Existing partial-failure, empty-state, filter, and pending tests still pass after assertion
   updates.

### Task 4: Normalize `Learning` to the shared masthead

**Files:**

1. modify `packages/batch-frontend/src/ui/students/StudentLearningPage.tsx`
2. update any affected `StudentLearningPage` tests if present

Steps:

1. Keep `Learning` as the canonical pedagogical editing surface.
2. Remove or reduce the local `Pedagogical Home` hero so it no longer acts as the primary page
   heading.
3. Start the page with profile health, revision state, memory snapshot, and promotion queue.
4. Keep generated helper actions near the profile workflow, but avoid making them the first visual
   thing if the teacher needs status orientation first.
5. Preserve all existing profile editing, revision, memory, and candidate workflows.

Acceptance checks:

1. `Learning` no longer feels like a separate application inside the student area.
2. Profile workflow actions remain available.
3. No profile editing behavior changes.
4. Existing tests for profile drafting, activation, and candidate promotion still pass.

### Task 5: Prepare `Schedule & Billing` to inherit the shell

**Files:**

1. modify `packages/batch-frontend/src/ui/students/StudentScheduleBillingPage.tsx`
2. add or update `packages/batch-frontend/src/ui/students/StudentScheduleBillingPage.test.tsx`

Steps:

1. Keep this page lightweight if the domain is not ready yet.
2. Remove any page-local hero assumptions.
3. Start with honest placeholder sections:
   - next lesson
   - lesson credits
   - reminders
   - invoices/payments
4. Use the shell `operations` density.
5. Make clear that scheduling and accounting are planned homes, not learner-profile fields.

Acceptance checks:

1. The page uses the shared masthead and operations density.
2. Placeholder copy does not imply unavailable features already work.
3. No billing, reminder, or calendar state is invented in the frontend.

### Task 6: Tune the student directory as the entry point

**Files:**

1. modify `packages/batch-frontend/src/ui/students/StudentDirectoryPage.tsx`
2. update any affected directory tests if present

Steps:

1. Add initials/avatar placeholders to student cards.
2. Keep student name and short ID visually consistent with the masthead.
3. Prefer one primary action, `Open student`, routing to `Overview`.
4. Keep `Open Learning` as a secondary link only if direct pedagogical editing remains a frequent
   operator path.
5. Avoid making directory cards look like dashboards.

Acceptance checks:

1. Opening a student feels like expanding the same identity from the directory into the masthead.
2. The directory does not duplicate page-specific student-area concepts.
3. Student creation still redirects to `Learning` unless product direction changes.

## Test And Verification Plan

Run targeted frontend tests first:

```bash
pnpm --filter @esl-pipeline/batch-frontend test -- StudentAreaShell StudentOverviewPage StudentHistoryPage StudentLearningPage StudentScheduleBillingPage StudentDirectoryPage
```

Then run the repo fast lane:

```bash
pnpm check:fast
```

For docs changes, run:

```bash
pnpm docs:check
```

For browser verification, use the local batch stack if available and inspect:

1. `/students`
2. `/students/:studentId/overview`
3. `/students/:studentId/learning`
4. `/students/:studentId/history`
5. `/students/:studentId/schedule-billing`

Visual acceptance:

1. there is one dominant student identity surface per student route
2. tabs sit close to the student identity, not inside page content
3. `History` reads as a narrower ledger
4. `Overview` remains wider and control-surface-like
5. `Learning` remains functional and does not lose editing affordances
6. mobile layouts keep the masthead, tabs, and page content in a readable order

## Risks And Guardrails

1. Do not move profile authority into the shell. The masthead can display identity and page context,
   but `Learning` remains the owner of profile editing.
2. Do not invent schedule, billing, reminder, or avatar backend state while doing shell work.
3. Do not remove existing pending canvases until equivalent loading behavior exists and is tested.
4. Do not make page density a global fixed width. The body must remain route-aware.
5. Do not let the shell become a dashboard. It is a quiet identity/navigation band.

## Relationship To Existing Plans

This phase complements the original phases rather than replacing them:

1. Phase 1 remains the authority for the four-page IA and domain boundaries.
2. Phase 2 remains the authority for the `Learning` page and structured profile.
3. Phase 4 remains the authority for `Overview` content and control-tower behavior.
4. Phase 5 remains the authority for `History`, scheduling, billing, reminders, and provenance.
5. This phase becomes the authority for shared student-area framing, masthead ownership, and
   route-level page density.

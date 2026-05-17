# Phase 7: Unified App And Student Area Design Language

Implementation status: the expanded Phase 7 implementation is in place on the current branch. The
student-area visual system now sits on global app tokens, the authenticated shell has replaced the
temporary `Minimal Flow` header with `Assignments` and `Students` navigation, direct-route auth
hydration is covered, browser screenshots have been captured under `tmp/`, and automatic dark-mode
startup is deferred to light mode until the editorial surfaces receive a complete dark-theme audit.
The authenticated shell background is a solid paper base with a fixed viewport ambience layer, so
long routes such as `History` cannot change the apparent page color while data finishes loading.

## Summary

This phase turns the authenticated app and student area from a set of aligned pages into one
coherent product surface.

Phase 6 fixed the structural problem: student identity, local navigation, and page density now live
in the shared student-area shell. The remaining risk is visual drift. `Overview` and `History` are
closest to the intended warm editorial teaching-studio style, while `Learning`, `Schedule &
Billing`, and parts of the student directory still carry more of the older workspace/card language.

The goal of Phase 7 is to create one app-wide design language that every authenticated surface can
share without weakening each page's product job.

## Product Goal

When a teacher moves between `Assignments`, `Students`, `Overview`, `Learning`, `History`, and
`Schedule & Billing`, the app should feel like one private teaching notebook with different rooms,
not separate interfaces wearing related colors.

The desired feel is:

1. calm
2. editorial
3. teacher-owned
4. warm but operational
5. structured without feeling like a dashboard
6. consistent without making every page the same width or layout

## Current Alignment Assessment

### Strongest Alignment

`Overview` and `History` already establish the right direction:

1. warm ivory/parchment surfaces
2. subtle paper texture
3. fine ink-like divider lines
4. refined serif headings
5. muted navy links
6. sage, amber, and rose semantic accents
7. quieter empty and loading states

### Partial Alignment

`StudentAreaShell` now owns the correct product structure and uses the right visual direction. Phase
7 promotes the stable parts of that direction into global app tokens, then lets student-area
primitives consume those tokens rather than becoming a one-off style island.

`StudentDirectoryPage` now visually foreshadows the masthead through initials and short IDs, but it
still uses generic card scaffolding in places.

### Weakest Alignment

`Learning` is functionally strong but visually still closest to the older workspace model:

1. generic `card` surfaces
2. denser grids
3. less editorial rhythm
4. action groups that feel more operational than studio-like
5. local styling that does not yet reuse shared student-area primitives

`Schedule & Billing` has the right placeholder honesty and domain separation, but it is not yet a
mature operations page.

## Locked Decisions

1. Do not collapse all pages into one layout. Unified language means shared primitives and tone, not
   identical composition.
2. The student route canvas is shared and stable. The app shell owns safe outer gutters, the
   student masthead and route body share one visual paper width, and page-specific density happens
   inside that canvas rather than changing the canvas color or horizontal position:
   - `Overview`: comfortable editorial control surface inside the shared paper
   - `Learning`: form-and-revision editing surface inside the shared paper
   - `History`: readable ledger inside the shared paper
   - `Schedule & Billing`: medium operations board inside the shared paper
   - `Directory`: standalone shelf/grid entry route that foreshadows the same identity system
     The app-shell ambience must be viewport-fixed rather than document-height-scaled, because
     route-specific content height otherwise changes the perceived background color during navigation.
3. Keep the shared masthead as the only full identity surface.
4. Keep `Learning` as the only profile editing surface.
5. Keep `Schedule & Billing` honest until real scheduling, credit, reminder, invoice, and calendar
   data exists.
6. Move toward shared primitives before adding new visual flourishes.
7. Browser verification is required before calling this phase done.
8. Dark mode is not currently an acceptance surface. Browsers that prefer dark color schemes should
   still start in the safe light theme until every app and student-area surface has dark-token
   coverage.

## Global And Student-Area Design System Target

The app should define stable global tokens in `index.css`, with student-area aliases and focused
React primitives layered on top. This keeps `Assignments` and `Students` in one authenticated app
language while avoiding a large redesign of the older assignment builder body.

### Tokens

Recommended shared tokens:

1. app paper background: warm ivory
2. app paper-deep background: parchment/sand
3. ink text: near-black warm brown
4. muted text: warm gray/brown
5. link/nav accent: muted navy
6. healthy accent: sage
7. attention accent: amber
8. warning accent: clay/rose
9. divider line: low-opacity ink
10. panel background: translucent warm white
11. major radius: `22px` to `30px`
12. small radius: `10px` to `14px`
13. editorial shadow: soft, low-opacity warm shadow
14. serif heading family: existing display token and Georgia fallback unless a broader font
    decision is made later
15. support text family: inherit existing app sans stack unless global typography changes later

### Primitives

Recommended primitives:

1. `StudentAreaFrame`
   - page-level paper surface when a page needs one
   - owns texture, border, radius, and warm background
2. `StudentAreaPanel`
   - standard content panel
   - supports quiet, attention, success, and warning tones
3. `StudentAreaSectionLabel`
   - consistent uppercase label treatment
4. `StudentAreaMetricCard`
   - reusable metric/status card for Learning, Overview, and Schedule & Billing
5. `StudentAreaActionLink`
   - consistent pill/button-like link treatment
6. `StudentAreaStatusPill`
   - compact state indicator
7. `StudentAreaEmptyState`
   - calm sparse-state language and layout
8. `StudentAreaSkeleton`
   - non-readable loading silhouette pattern
9. `StudentAreaNote`
   - optional handwritten/editorial footer motif

The implementation can begin with shared CSS classes if extracting React components would create
too much churn. The product target is consistency, not abstraction for its own sake.

## Page-Specific Targets

### Overview

Keep mostly intact.

Phase 7 should:

1. replace local one-off CSS values with shared tokens
2. reuse shared panel/action/status primitives
3. preserve the calm control-surface composition
4. keep operations secondary
5. keep loading silhouettes aligned with final content

### Learning

This is the highest-impact convergence page.

Phase 7 should:

1. restyle status metrics as editorial student-area metric cards
2. reduce the generic workspace-card feeling
3. make the foundational profile form feel like a teacher notebook section, not an admin form
4. keep generated helpers useful but visually secondary
5. preserve all profile editing, save, activation, candidate review, and memory workflows
6. avoid hiding important actions behind overly decorative styling

Recommended first visual order:

1. profile readiness and revision state
2. memory snapshot and promotion queue
3. generated helper actions
4. foundational profile sections
5. memory/candidate/revision support areas

### History

Keep mostly intact.

Phase 7 should:

1. reuse shared tokens and panel primitives
2. keep the reading-width ledger
3. preserve event hierarchy and provenance behavior
4. tune filter pills to match shared action styles
5. keep `About this history` as the first page-specific panel

### Schedule & Billing

Build a mature placeholder surface without inventing unavailable data.

Phase 7 should:

1. turn placeholders into a coherent operations board
2. group the four near-term domains:
   - next lesson
   - lesson credits
   - reminders
   - invoices and payments
3. use honest copy such as `Not scheduled yet`, `Not configured yet`, and `Not tracked yet`
4. avoid fake balances, fake dates, fake reminder counts, or fake invoice states
5. make clear that this page is the future home for business operations

### Student Directory

The directory should feel like the entry shelf for the same identity system.

Phase 7 should:

1. align card texture, radius, and avatar treatment with the masthead
2. keep `Open student` as the primary action
3. keep `Open Learning` secondary if direct editing remains useful
4. avoid dashboard-like student cards

## Implementation Plan

### Task 1: Create Shared Student-Area Styling Primitives

**Files:**

1. create or modify `packages/batch-frontend/src/ui/students/StudentAreaDesignSystem.tsx`
2. modify `packages/batch-frontend/src/index.css` for global app tokens and compatibility aliases
3. update `packages/batch-frontend/src/ui/students/studentIdentity.ts` only if identity helpers need
   small additions

Steps:

1. Inventory repeated style values in `StudentAreaShell`, `StudentOverviewPage`, and
   `StudentHistoryPage`.
2. Define shared token names for paper, ink, muted, navy, sage, amber, rose, line, panel, radius, and
   shadow.
3. Create the smallest reusable primitive set needed for Phase 7:
   - frame
   - panel
   - section label
   - metric card
   - action link
   - empty state
4. Do not rewrite every page in this task.
5. Add tests only where primitives affect rendered behavior or accessible labels.

Acceptance checks:

1. shared global tokens exist in one obvious place
2. the primitive API is small enough to understand quickly
3. existing student-area tests still pass

### Task 1A: Replace The Temporary Authenticated App Header

**Files:**

1. modify `packages/batch-frontend/src/ui/minimal/MinimalShell.tsx`
2. modify `packages/batch-frontend/src/ui/App.test.tsx`

Steps:

1. Replace the fixed `Minimal Flow` header with an editorial app shell.
2. Rename `Minimal Flow` to `Assignments`.
3. Keep top-level navigation limited to `Assignments` and `Students`.
4. Add a skip link and semantic `<main id="main-content">`.
5. Use `NavLink`, visible focus states, safe-area-aware padding, and explicit transitions.

Acceptance checks:

1. authenticated app routes render inside the shared shell
2. primary nav labels are `Assignments` and `Students`
3. the skip link targets `#main-content`
4. no new app sections are invented

### Task 2: Apply Shared Primitives To The Shell, Overview, And History

**Files:**

1. modify `packages/batch-frontend/src/ui/students/StudentAreaShell.tsx`
2. modify `packages/batch-frontend/src/ui/students/StudentOverviewPage.tsx`
3. modify `packages/batch-frontend/src/ui/students/StudentHistoryPage.tsx`

Steps:

1. Replace duplicated color/radius/shadow values with shared tokens or classes.
2. Keep the current shell, Overview, and History compositions.
3. Verify no page-local identity hero returns.
4. Keep pending canvases non-readable.
5. Keep `History` on reading density.

Acceptance checks:

1. no functional behavior changes
2. no visible regression in route links or loading states
3. targeted tests remain green

### Task 3: Bring Learning Into The Unified Design Language

**Files:**

1. modify `packages/batch-frontend/src/ui/students/StudentLearningPage.tsx`
2. update `packages/batch-frontend/src/ui/students/StudentLearningPage.test.tsx` only if accessible
   behavior changes

Steps:

1. Restyle the top status area using shared metric cards.
2. Convert profile section cards to the shared panel language.
3. Make generated helper actions visually secondary but still easy to find.
4. Preserve form fields, save flow, activation flow, candidate workflow, and memory loading.
5. Preserve the current test-covered behavior.

Acceptance checks:

1. `Learning` feels like the same product as `Overview` and `History`
2. profile editing remains immediately usable
3. no profile workflow behavior changes

### Task 4: Mature Schedule & Billing Placeholder Surface

**Files:**

1. modify `packages/batch-frontend/src/ui/students/StudentScheduleBillingPage.tsx`
2. update `packages/batch-frontend/src/ui/students/StudentScheduleBillingPage.test.tsx`

Steps:

1. Use shared panels and metric/action styles.
2. Keep four placeholder domains visible:
   - next lesson
   - lesson credits
   - reminders
   - invoices and payments
3. Add a clear explanatory note that these are operational homes, not learner-profile fields.
4. Do not create frontend-only state for real billing/scheduling/reminder values.

Acceptance checks:

1. placeholders are honest
2. page visually belongs to the student area
3. no unavailable feature appears actionable as if implemented

### Task 5: Tune Directory Continuity

**Files:**

1. modify `packages/batch-frontend/src/ui/students/StudentDirectoryPage.tsx`
2. update `packages/batch-frontend/src/ui/students/StudentDirectoryPage.test.tsx` only if behavior
   changes

Steps:

1. Align directory cards with shared panel, avatar, and action styles.
2. Keep the directory lighter than the student detail pages.
3. Preserve create-student behavior and redirect.

Acceptance checks:

1. opening a student feels like zooming into the same identity system
2. student cards are not dashboards
3. directory tests remain green

### Task 6: Browser Visual Verification

**Files:**

1. create screenshots under `tmp/` only
2. do not commit generated screenshots unless a maintainer explicitly asks

Steps:

1. Use the existing local batch stack if running.
2. Inspect:
   - `/students`
   - `/students/:studentId/overview`
   - `/students/:studentId/learning`
   - `/students/:studentId/history`
   - `/students/:studentId/schedule-billing`
3. Capture desktop screenshots.
4. Capture at least one narrow/mobile viewport screenshot.
5. Record any visual defects in this plan or a follow-up note.

Acceptance checks:

1. pages share one visual language
2. page density variants remain distinct and appropriate
3. mobile ordering is readable
4. `Learning` does not become decorative at the cost of usability

## Verification Plan

Run targeted frontend tests:

```bash
pnpm --filter @esl-pipeline/batch-frontend test -- StudentAreaShell StudentOverviewPage StudentHistoryPage StudentLearningPage StudentScheduleBillingPage StudentDirectoryPage
```

Run the repo fast lane:

```bash
pnpm check:fast
```

Run docs validation if this plan or related docs change:

```bash
pnpm docs:check
```

For visual work, also perform browser verification and save temporary screenshots under `tmp/`.

Also verify direct full-page loads after login for `/`, `/students`, `/students/:studentId/overview`,
`/students/:studentId/learning`, `/students/:studentId/history`, and
`/students/:studentId/schedule-billing`.

Also verify a browser context with `prefers-color-scheme: dark` and/or a stored dark preference. The
expected Phase 7 behavior is a readable light startup, not automatic dark mode.

## Risks And Guardrails

1. Do not refactor profile workflows while doing visual convergence.
2. Do not invent real schedule, billing, reminder, calendar, or avatar data.
3. Do not let page-appropriate density change the outer student-route paper. Vary interior grids,
   not the shared canvas color or horizontal position.
4. Do not make all pages look identical; preserve page purpose.
5. Do not over-abstract before two or three pages prove the primitive shape.
6. Do not rely only on unit tests for a visual-language phase.
7. Do not re-enable automatic system dark mode until the app shell, assignment builder, auth dialog,
   and every student-area route have first-class dark surfaces.

## Relationship To Earlier Phases

1. Phase 1 remains the authority for page IA and domain split.
2. Phase 2 remains the authority for learner profile behavior.
3. Phase 4 remains the authority for Overview content and next-action behavior.
4. Phase 5 remains the authority for Schedule & Billing and History domain ownership.
5. Phase 6 remains the authority for the original shared student masthead structure and removal of
   duplicated page-local identity heroes.
6. Phase 7 supersedes Phase 6 for app shell styling, shared student-route canvas ownership, shared
   visual primitives, and cross-page look-and-feel convergence.

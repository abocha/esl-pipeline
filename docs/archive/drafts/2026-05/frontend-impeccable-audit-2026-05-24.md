# Frontend Impeccable Audit - 2026-05-24

## Scope

Audit target: `packages/batch-frontend/src` as a whole, using the `impeccable audit`
technical-quality rubric.

Covered surfaces:

- Auth gate and auth dialog.
- App shell and primary navigation.
- Minimal assignment workflow.
- Prompt templates page.
- Business schedule, stats, and settings pages.
- Student directory.
- Student area shell, overview, learning, history, and schedule/billing pages.
- Legacy `StudentWorkspace` and split workspace panels.

Browser coverage:

- Opened the production preview at `http://127.0.0.1:4173/`.
- Verified the unauthenticated shell at desktop and 390px mobile widths.
- Opened the login dialog and inspected live modal semantics.
- Opened the authenticated local dev app at `http://localhost:5173/` using the in-app Browser.
- Desktop smoke coverage at 1057x910:
  - Assignments: loaded `MinimalAssignment` at `/`, including resume/new, student, transcript,
    teaching-context, assignment, share, and advanced sections.
  - Students: loaded `/students`, including active student cards and Overview/Learning links.
  - Business: loaded `/business`, which redirected to `/business/schedule`, including lesson agenda,
    reminder queue, credit alerts, and recent payments.
  - Prompts: loaded `/prompts`, including template selection, editor, revision history, and action
    controls.
  - Student detail: loaded one student's `/overview`, `/learning`, and `/schedule-billing` routes.
- Mobile smoke coverage at 390x844 covered `/`, `/students`, `/business`, and `/prompts`.
- No route in the mobile smoke pass showed document-level horizontal overflow; the authenticated
  routes remain very tall and dense on phone width.

Validation commands run:

- `pnpm --silent --filter @esl-pipeline/batch-frontend typecheck`
- `pnpm --silent --filter @esl-pipeline/batch-frontend build`
- `pnpm --silent --filter @esl-pipeline/batch-frontend lint`
- `pnpm --silent run test:unit:prebuilt:fast:agent`
- `pnpm docs:check`
- `pnpm exec prettier --check docs/drafts/frontend-impeccable-audit-2026-05-24.md`

Result: all passed. The agent unit lane reported 873 tests and 375 suites passing.

## Health Score

| Dimension         | Score | Key finding                                                                                            |
| ----------------- | ----: | ------------------------------------------------------------------------------------------------------ |
| Accessibility     |   2/4 | Auth modal lacks dialog semantics and focus containment; tables miss scoped headers.                   |
| Performance       |   3/4 | Build passes, but the root `index` chunk is still above the Vite warning threshold.                    |
| Responsive design |   3/4 | Major layouts have breakpoints, but several controls and grids still carry small/fixed affordances.    |
| Theming           |   2/4 | Theme API exists but coerces to light, while dark-theme CSS and local hard-coded values remain.        |
| Anti-patterns     |   2/4 | Product UI still carries decorative auth/hero treatments, fluid type, and repeated card-heavy layouts. |
| Total             | 12/20 | Acceptable, but a real hardening pass is needed before calling the frontend polished.                  |

## Findings

### P1 - Auth dialog is not an accessible modal

Location:

- `packages/batch-frontend/src/ui/auth/AuthDialog.tsx`

Evidence:

- The live dialog rendered with zero `[role="dialog"]` elements.
- The overlay/container does not expose `aria-modal` or `aria-labelledby`.
- Focus starts in the email input, but there is no focus trap or inert background.
- Escape close exists, and the close button has an accessible name, which is good.

Impact:

Screen-reader and keyboard users do not get a real modal boundary. Focus can escape to background
content, and assistive tech is not told which heading names the dialog.

Recommendation:

Use a real dialog primitive or add `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, initial
focus management, focus return, and background inerting.

### P2 - Root bundle remains large

Location:

- `packages/batch-frontend/src/ui/App.tsx`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`

Evidence:

- Production build warned that `dist/assets/index-*.js` is 509.49 kB minified.
- Route components are mostly lazy-loaded, but `MinimalAssignment` is eagerly imported into the root
  app shell.

Impact:

Unauthenticated users and first-time sessions pay for the assignment workflow before they can use the
app. This also makes future workflow growth more likely to regress first-load performance.

Recommendation:

Lazy-load `MinimalAssignment` like the other route surfaces and consider separating its advanced
workflow/controller code into route-level chunks.

### P2 - Authenticated form controls need stronger accessible names

Location examples:

- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- `packages/batch-frontend/src/ui/business/BusinessDashboard.tsx`
- `packages/batch-frontend/src/ui/prompts/PromptTemplatesPage.tsx`
- `packages/batch-frontend/src/ui/students/StudentLearningPage.tsx`
- `packages/batch-frontend/src/ui/students/StudentScheduleBillingPage.tsx`

Evidence:

- The authenticated browser pass found many `select`, date/time, number, and textarea controls with
  no `aria-label` and no directly observable accessible name in the DOM snapshot.
- Some controls are well named, for example `Teacher notes`, `Draft markdown`, and student action
  menus. The issue is inconsistency across dense admin forms.
- Affected live surfaces include Assignments, Business schedule, Prompt templates, Student Learning,
  and Student Schedule & Billing.

Impact:

Keyboard and screen-reader users can reach dense forms but may not get enough context for what each
control changes. The risk is highest in schedule/billing and learning-profile editors where adjacent
fields have similar input types.

Recommendation:

Normalize form rows around explicit `<label for>`/`id` pairs or reliable `aria-label` values, then
add a small accessibility smoke test for key authenticated forms.

### P2 - Theme contract is internally inconsistent

Location:

- `packages/batch-frontend/src/context/ThemeContext.tsx`
- `packages/batch-frontend/src/index.css`
- Feature CSS files under `packages/batch-frontend/src/ui/**`

Evidence:

- `ThemeContext` only persists and applies `light`.
- `toggleTheme()` sets light, and `setTheme('dark')` coerces to light.
- Dark-theme CSS variables and feature-level dark selectors still exist.
- Many feature styles use local `white`, `#fffaf1`, `rgba(...)`, and page-specific colors.

Impact:

Agents and maintainers can mistakenly assume the app supports dark mode. Hard-coded feature values
also make a future theme repair much broader than it should be.

Recommendation:

Either remove the dark-mode contract and stale dark CSS intentionally, or make dark mode product-ready
with token-only feature styling and actual UI affordances.

### P2 - Product UI uses fluid display typography

Location examples:

- `packages/batch-frontend/src/ui/prompts/PromptTemplatesPage.css`
- `packages/batch-frontend/src/ui/business/BusinessDashboard.css`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.css`
- `packages/batch-frontend/src/ui/students/StudentAreaShell.css`
- `packages/batch-frontend/src/ui/students/StudentHistoryPage.css`
- `packages/batch-frontend/src/ui/students/StudentOverviewPage.css`

Evidence:

- Multiple product surfaces use `font-size: clamp(...)`.
- Student shell/history also use negative letter spacing.

Impact:

The UI can look editorial and oversized in places where teachers need task density, stable scanning,
and predictable component sizing. It also violates the project-facing product UI guidance used for
this audit.

Recommendation:

Replace route/page display clamps with fixed token steps and reserve large type for true page headers
only. Remove negative letter spacing from app UI.

### P2 - Table semantics need cleanup

Location:

- `packages/batch-frontend/src/ui/students/WorkspaceHistoryPanel.tsx`
- `packages/batch-frontend/src/ui/students/StudentWorkspace.tsx`

Evidence:

- Job history tables use `<th>` without `scope="col"`.
- The action column is rendered as an empty `<th />`.

Impact:

Assistive technology gets weaker table navigation, especially in dense job-history rows where actions
are already compact.

Recommendation:

Add scoped headers, give the action column a visually hidden label, and consider extracting the shared
job-history table to avoid divergence between legacy and split panels.

### P2 - Legacy workspace and split panels duplicate dense UI patterns

Location:

- `packages/batch-frontend/src/ui/students/StudentWorkspace.tsx`
- `packages/batch-frontend/src/ui/students/WorkspaceHistoryPanel.tsx`
- `packages/batch-frontend/src/ui/students/WorkspaceCandidatesPanel.tsx`
- `packages/batch-frontend/src/ui/students/WorkspaceInspectionPanel.tsx`

Evidence:

- `StudentWorkspace` still renders a large all-in-one workspace with profile, template, history,
  candidate, timeline, and inspection panels.
- Split panels exist beside it, duplicating tables/cards/actions.

Impact:

The frontend has two competing workspace vocabularies. This increases maintenance cost and makes
accessibility/theming fixes likely to land in one surface but not the other.

Recommendation:

Decide whether `StudentWorkspace` is legacy-only. If yes, route users to the split student-area
surfaces and retire or isolate the legacy workspace. If not, extract shared table/action/card
components so fixes apply once.

### P2 - Product surfaces are still card-heavy

Location examples:

- `packages/batch-frontend/src/ui/students/StudentDirectoryPage.tsx`
- `packages/batch-frontend/src/ui/students/StudentLearningPage.tsx`
- `packages/batch-frontend/src/ui/students/StudentWorkspace.tsx`
- `packages/batch-frontend/src/ui/prompts/PromptTemplatesPage.tsx`

Evidence:

- Many route-level sections use `card`, `hero`, `panel`, and nested repeated card language.
- Student learning/profile/memory/sidebar areas combine `student-area-panel`, `workspace-card`, and
  `card` classes.

Impact:

The application reads more like a designed presentation than a quiet workbench in several places.
The effect is not broken, but it is harder to scan and maintain than a smaller set of panels,
lists, tables, and inline controls.

Recommendation:

Consolidate page shells and repeated item containers. Use cards only for repeated items, modals, and
genuinely framed tools.

### P2 - Touch targets are inconsistent

Location examples:

- `packages/batch-frontend/src/ui/auth/AuthDialog.css`
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.css`
- `packages/batch-frontend/src/ui/students/StudentAreaDesignSystem.css`
- `packages/batch-frontend/src/ui/students/StudentOverviewPage.css`

Evidence:

- The auth close button is 36x36.
- Several chips, icon affordances, and compact action buttons use small padding or fixed 32px-style
  dimensions.
- The live student schedule route still exposes 36px lesson action buttons (`Complete`, `No-show`,
  `Cancel`, `Edit`) on desktop, while other newer controls are 41-50px.

Impact:

Mobile and touch users can hit controls less reliably, especially in dense schedule/history/workflow
sections.

Recommendation:

Set a shared 44px minimum target for icon buttons and touch-first action controls, while preserving
dense desktop layouts through media queries.

### P3 - Decorative motion and unused animation tokens remain

Location:

- `packages/batch-frontend/src/index.css`
- `packages/batch-frontend/src/ui/shared/DropZone.tsx`

Evidence:

- Global CSS still defines bounce/float/gradient-shift animation utilities.
- Dropzone toggles a `bounce` icon class.
- Reduced-motion handling exists, which is good.

Impact:

This is not a blocker, but it keeps an older decorative vocabulary in the shared system.

Recommendation:

Remove unused decorative animation utilities or confine them to a component-local state transition
where they communicate actual feedback.

## Positive Findings

- The frontend builds, typechecks, lints, and passes the fast agent unit lane.
- Route-level lazy loading already exists for most authenticated pages.
- Skip link and main focus target exist in `MinimalShell`.
- Many student-area pending states use skeletons rather than plain spinners.
- Reduced-motion CSS is present across global and student-area surfaces.
- Newer student-area pages use stale-request guards and route-aware loading patterns.
- Business and student pages expose many errors with alert/status semantics.

## Recommended Repair Order

1. `impeccable harden auth dialog`: fix modal semantics, focus trap, focus return, and form error
   announcements.
2. `impeccable optimize root assignment route`: lazy-load `MinimalAssignment` and re-check bundle
   output.
3. `impeccable extract frontend tokens`: reconcile theme tokens, remove stale dark-mode contract or
   make it real, and replace feature-level hard-coded colors.
4. `impeccable adapt dense controls`: enforce 44px touch targets where controls are tap-first and
   audit compact grids at 390px, 720px, 1024px, and desktop.
5. `impeccable harden workspace tables`: add table header scopes/action labels and deduplicate job
   history table markup.
6. `impeccable distill student workspace`: decide whether the legacy all-in-one workspace remains
   active; retire or extract shared pieces.
7. `impeccable label authenticated forms`: add explicit labels/accessibility names to dense
   assignment, business, prompt, learning, and schedule/billing form controls.
8. `impeccable polish frontend`: repeat the authenticated Browser smoke after repairs and add deeper
   interaction checks for create/edit modals, destructive actions, and save flows.

## Repair Pass - 2026-05-24

Status: the first hardening pass is implemented.

Completed:

- Auth dialog now exposes modal semantics, traps focus, restores focus to the launcher, locks body
  scroll while open, and announces validation errors through an assertive alert.
- Root assignment route now lazy-loads `MinimalAssignment`; the production entry chunk dropped from
  the audited 509.49 kB warning case to 317.73 kB, with `MinimalAssignment` emitted as its own chunk.
- Stale dark-theme selectors, unused decorative animation utilities, fluid product typography, and
  negative letter spacing were removed from the audited UI styles.
- Dense authenticated controls were normalized around 44px minimum tap targets across auth,
  assignment, prompts, student directory, student shell, student schedule/billing, business, and
  workspace controls.
- Reminder copy textareas in business and student schedule surfaces now have explicit accessible
  names.
- Workspace job-history tables now use scoped headers and a named action column.

Browser verification:

- Fresh preview used: `http://localhost:4174/` from the current Windows worktree build.
- Auth smoke verified dialog role, `aria-modal`, labelled/described wiring, initial Email focus, body
  scroll lock, assertive validation alert, close behavior, and focus return.
- Authenticated route sweep covered `/`, `/students`, `/business`, `/prompts`, and one student's
  `/schedule-billing` route using the in-app Browser.
- Final sampled routes (`/`, `/prompts`, `/students/:id/schedule-billing`) reported no visible
  sub-44px interactive controls, no unlabeled visible fields, and no empty table headers. The hidden
  1px file input behind the assignment dropzone was excluded as an implementation detail.

Validation after repairs:

- `pnpm --silent --filter @esl-pipeline/batch-frontend test -- App.test.tsx`
- `pnpm --silent --filter @esl-pipeline/batch-frontend typecheck`
- `pnpm --silent --filter @esl-pipeline/batch-frontend lint`
- `pnpm --silent --filter @esl-pipeline/batch-frontend build`
- `pnpm --silent run check:fast:agent`

Remaining:

- The broader product-vocabulary concern remains partly architectural: the frontend still has several
  card-heavy route compositions and the legacy `StudentWorkspace` still exists beside split panels.
  This pass hardened shared controls/tables and reduced drift, but did not retire the legacy surface
  or redesign page composition.

## Repair Continuation - 2026-05-25

Status: the remaining product-vocabulary repair was narrowed and partially retired without a visual
redesign.

Completed:

- Confirmed `StudentWorkspace` is no longer routed from the app shell; it remains a legacy/test
  harness surface while the split student-area routes own active navigation.
- Extracted the duplicated workspace assignment-history table into a shared
  `WorkspaceAssignmentHistoryTable` component used by both `WorkspaceHistoryPanel` and the legacy
  `StudentWorkspace`.
- Replaced layered generic `card` classes on student-directory, student-learning, and workspace
  panels with route-owned `student-area-panel` / `workspace-panel` surface vocabulary.
- Renamed the remaining prompt-template editor/revision `*-card` surfaces to `*-surface` and moved
  their local color literals to route-owned token variables.
- Removed the last generic `.card` utility usage from the app shell loading/unauthenticated states
  and deleted the now-unused global `.card`, `.card-glass`, and `.glass-panel` styles.
- Replaced local color literals in the auth dialog, app shell circle treatment, student directory,
  prompt templates, and workspace primary button with existing tokens or route-owned variables.
- Retired the remaining feature-level CSS color literals in `MinimalAssignment.css`,
  `StudentLearningPage.css`, `StudentOverviewPage.css`, `StudentAreaDesignSystem.css`,
  `StudentAreaShell.css`, `MinimalShell.css`, `StudentScheduleBillingPage.css`,
  `BusinessDashboard.css`, and `StudentHistoryPage.css` by moving them to existing tokens or
  local semantic variables.
- Preserved existing visual density and spacing while moving the workspace panel skin into
  `StudentWorkspace.css`, so the cleanup reduces naming/style drift rather than redesigning the
  active surfaces.

Browser coverage added:

- Restarted Docker frontend container `esl-pipeline-batch-frontend-1`, then sampled the running
  `http://localhost:5173/` app across `/`, `/students`, and `/prompts`.
- The live sampled routes reported no app console errors, no horizontal overflow, active nav state
  via `aria-current`, and no unlabeled visible buttons.
- The refreshed `/students` DOM reported zero
  `student-area-panel.card` / `workspace-card.card` / `workspace-hero.card` matches.
- `/` still reports one sub-44px interactive item: the hidden 1x1 assignment file input behind the
  visible dropzone, which remains an implementation detail rather than a visible tap target.
- After the token cleanup, restarted `esl-pipeline-batch-frontend-1` again and sampled `/`,
  `/students`, `/students/demo-student/overview`, `/students/demo-student/learning`,
  `/students/demo-student/history`, `/students/demo-student/schedule-billing`, `/business`, and
  `/prompts` in the in-app Browser.
- The second sampled route set reported no app console errors, no horizontal overflow, zero generic
  card/glass matches, zero unlabeled visible buttons, and zero visible sub-44px interactive controls.
- A safe live interaction pass opened the student create panel from `/students`, verified all visible
  create-panel inputs/selects/textareas had accessible names, then canceled without submitting.
- The same pass followed a real student link from `/students` into overview, learning, history, and
  schedule/billing. Those actual student routes reported no app console errors, no horizontal
  overflow, zero unlabeled visible buttons, and zero unlabeled visible form controls.
- Responsive breakpoint verification used the in-app Browser viewport override at 390, 720, 1024,
  and 1280px widths across `/`, `/students`, `/business`, and `/prompts`; every sampled route
  reported no horizontal overflow, zero unlabeled visible buttons, and zero visible sub-44px
  interactive controls.
- Mutating/destructive deeper-flow coverage is backed by targeted tests rather than live Browser
  writes: prompt template save/create/archive confirmation, student archive/restore confirmation,
  schedule/billing no-show/cancel/edit/payment/restore, business reminder completion/undo, and
  business settings save.

Validation after continuation:

- `pnpm --silent --filter @esl-pipeline/batch-frontend typecheck`
- `pnpm --silent --filter @esl-pipeline/batch-frontend test -- StudentWorkspace.loading-inspection.test.tsx StudentLearningPage.test.tsx StudentDirectoryPage.test.tsx`
- `pnpm --silent --filter @esl-pipeline/batch-frontend test -- App.test.tsx PromptTemplatesPage.test.tsx StudentDirectoryPage.test.tsx`
- `pnpm --silent --filter @esl-pipeline/batch-frontend lint`
- `pnpm --silent --filter @esl-pipeline/batch-frontend test -- App.test.tsx PromptTemplatesPage.test.tsx StudentDirectoryPage.test.tsx StudentLearningPage.test.tsx StudentWorkspace.loading-inspection.test.tsx`
- `pnpm --silent --filter @esl-pipeline/batch-frontend build`
- `pnpm --silent run check:fast:agent`

Remaining:

- Feature-level color token debt from this repair order is retired. The current source search for
  feature CSS color literals only reports `white-space` false positives in
  `MinimalAssignment.css`, `StudentOverviewPage.css`, `MinimalShell.css`, and
  `StudentHistoryPage.css`.

# Calm Studio v2 integrated frontend

## Meta

- Status: active
- Last Verified Against: 2026-11-11 release preparation and isolated PostgreSQL verification
- Exit Trigger: archive after the integrated frontend delivery is merged and switch acceptance is recorded
- Current Focus: paired release PR; hosted checks and v2 switch acceptance remain open
- Execution: [ESL-95](https://linear.app/abocha/issue/ESL-95/integrate-calm-studio-v2-frontend-and-prepare-verified-switch)

The maintainer authorized finishing the v2 frontend and preparing it for replacement of the active UI. Deployment and the final production switch remain separate actions. The local prototype is design evidence, not a production state owner.

## Delivery boundary

Reuse actual Student, Business, Calendar and MinimalAssignment controllers. Introduce one reversible, default-off presentation selector, `VITE_CALM_STUDIO_V2=true`, inside the authenticated provider tree. Preserve existing deep links, authentication, workspace timezone gates, account/admin/legal controls and dirty-navigation protection. Do not convert real DTOs into the reduced prototype Workbook or fixture models.

Split student Schedule/Billing with one mounted controller across sibling routes. Retain the old combined URL for compatibility. Add a truthful assignment list using existing durable resume/job semantics. Preserve the complete native AssignmentV1 editor, upload/source/confirmation, CAS/conflicts, preview, Share jobs, corrections and reruns.

## Necessary backend work / readiness blockers

- Active assignment pagination is implemented through the existing list contract. HTTP/frontend regressions and a fresh PostgreSQL ownership/order/offset/count regression pass. Live offset pages are not a frozen snapshot when other work changes session ordering.
- [Automatic profile maintenance and selective undo](calm-studio-v2-profile-maintenance.md) are implemented: student-owned change/suppression records, verified original evidence, atomic active-head preconditions, and protected tutor fields. Existing candidate approval endpoints remain available for facts ineligible for automatic additions. No simulated success enters the real routes.
- Lesson completion preserves a separate planned-charge intent, manual start-time and automatic end-time gates, zero-cost No-show, and existing ledger idempotency. Existing lessons retain unknown charge intent until reviewed; historical credits are not backfilled.
- Preserve Google-owned timing/recurrence and exact provider identity. No prototype Calendar edit or success simulation may enter real routes.

## Switch acceptance

- No fixture imports or local pretend success in integrated routes.
- Existing frontend remains the default while v2 is selected for acceptance.
- Real route loading/empty/error/retry, archive/restore, paging/timezones, credit/payment isolation, profile drafts and navigation guards pass focused checks.
- Full native assignment source-to-share/recovery behavior remains available and validated.
- Approved design differences have concrete delivered behavior or explicit blockers; no missing work is hidden by a broad readiness percentage.
- Package typecheck/build, focused regressions, integrated browser acceptance and independent review have inspectable evidence.
- Hosted CI, production/provider acceptance and deployment evidence are reported separately. Local success is not a deployment claim.

## Release preparation

V2 is selected by the `VITE_CALM_STUDIO_V2=true` frontend build environment or Docker build
argument. The flag changes presentation and routes, never authorization. The standard
[release workflow](../../.github/workflows/release-on-merge.yml) uses the Dockerfile default
and publishes v1. After switch acceptance, change the build default in a reviewed follow-up
and publish the new frontend through the same workflow. The build embeds the setting in the
frontend bundle, so changing an environment variable on an existing deployment cannot select v2.

API 13.0.0 and DB 6.0.0 describe the mandatory profile revision preconditions and incompatible
migrations 0075 and 0076. The paired release requires the
[coordinated migration procedure](../backend-frontend/DEPLOYMENT.md#schema-compatibility-and-recovery)
with a verified backup, old API and worker writers quiesced, and matching new backend and frontend
images. Stale browser writes receive an explicit conflict or precondition error. Both presentations
expose Profile updates and selective undo, so the default frontend can accompany the new backend.
Once the database is on this release, returning from v2 to v1 should use a release bundle that
supports the migrated schema.

## Delivered workflow

- Your day and Assignments use actual agenda, active sessions, job history, student filters and durable resume links. The native source-to-share workflow, corrections and recovery remain authoritative.
- Student Overview, Learning, History, Schedule and Billing share the larger typography, teal accent and compact hierarchy. Learning shows the summary by default, actual upcoming lesson and assignment links, dated lesson/homework memory and lazy exact transcript access.
- Automatic profile updates show New/Changed items, before/current values, book-icon evidence access and individual Undo. Conflicts preserve later tutor edits; undone facts remain suppressed for the same evidence. Suggestions are optional.
- Schedule/Billing share one mounted controller. Google retains calendar timing/recurrence; lesson outcomes, planned charge, actual credit ledger, payments and packages retain separate durable meaning.
- Mobile navigation, all five student tabs, Calendar target focus, centered dialogs and keyboard focus return were corrected. Assignment controls now use the same accent and restrained interaction treatment.

Payment correction/reversal, assignment deletion and an additional HTML export are explicitly deferred from this switch. Generic simulated memory retry remains prototype-only.

## Local evidence

Counts below identify separate runs; they are not a single summed test total.

- Integrated frontend batch: 22 files, 335 tests passed. Final targeted batch: 137/138 passed; its stale sandbox student-count assertion was corrected and that file reran with 23/23 passing. Frontend typecheck passed.
- Additional focused checks passed for Learning context/transcript access (29), shared Schedule/Billing controller (22), student shell/directory (15), Day (2), and native resume/correction/workflow (91).
- Operations PostgreSQL suites: schedule/billing 64, Calendar 39, migration regression 1; assignment HTTP 24 and frontend/native/API 81 passed.
- Profile persistence evidence includes pure policy 43, HTTP 68 and PostgreSQL 129 tests across isolated runs; the final publication/lock-order fixes passed 99 focused tests and a final 8-case regression pass. Independent review closed the publication, suppression and candidate lock-order findings.
- Active-session owner/order/offset/count regression passed against a fresh dedicated PostgreSQL database on 2 November.
- Backend and frontend typechecks, contracts build and release contract consistency passed. Both default-v1 and selected-v2 frontend production builds passed on 2 November. Existing Vite config/chunk-size warnings remain.
- Schema baseline was regenerated and restored into a fresh database successfully. The dump normalizer now preserves executable function-body SET statements and deferred function-body validation; its three focused regressions pass.
- Changed-file lint has no errors; CSS specificity, conditional-expect and hook/module warnings remain. Dockerfile lint passed. Working-tree Markdown links passed across 367 sources. Full documentation checks retain unrelated age-only failures; PR freshness mode records those as warnings.
- Rendered mock-auth assessment covered desktop and 390px phone: Day, Assignments/native published resume, student navigation, Learning/profile updates/Undo/transcript, Schedule and Billing/payment form. Keyboard navigation and dialog focus return were observed. These browser checks use local fixtures; PostgreSQL tests provide persistence evidence separately.
- Release preparation passed both frontend production builds, both application typechecks,
  contract and schema-baseline verification, the migration suite, 240 targeted PostgreSQL
  tests, and 131 focused pure and deterministic HTTP tests.
- A 200% Chrome zoom check opened nine mock-auth routes: Day, Assignments, New assignment,
  Business Schedule, and all five Student tabs. It detected no horizontal page or student-pane
  overflow at 712 CSS pixels. Full workflow coverage with assistive technology remains open.

## Remaining release gates

- Complete the screen-reader and detailed zoom interaction pass for inventory CS2-207.
- Run hosted PR checks for the paired release. No hosted CI or image publication is claimed by this local evidence.
- Perform authenticated provider and production smoke acceptance under the existing release procedure. No live Google/provider mutation or production migration was performed here.
- Authorize and execute the coordinated incompatible cutover separately. Presentation selection can return to v1, but an old backend image cannot safely be rolled back over new durable writes without the established compatible database recovery procedure.

## Persistent local review playground

On 2 November, started v2 at `http://127.0.0.1:15173` against the actual local API on
`http://127.0.0.1:18080`, a fresh `esl_v2_playground_20261102` database on port 55495 and a
separate Redis on port 56380. The standard smoke database had a pre-existing migration-0064
checksum mismatch; it was preserved without reset or checksum changes. Task launch files and
private synthetic-account credentials live under ignored `tmp/v2-playground/`.

Browser checks verified normal sign-in/session restoration; creation of Alex with a structured
profile; a saved profile revision; a dated USD 120 payment independent of four lesson credits;
and persistence after reload. Maria and Daniel were added through the authenticated local API.
Business Stats reflects the actual payment. Workspace timezone was saved as Asia/Ho_Chi_Minh.

The native assignment flow persisted a pasted synthetic transcript and teaching guidance,
confirmed context, appeared in Assignments and Your day, and resumed from its exact session URL
with the saved values. With paid providers disabled, memory generation fails honestly and
initial enrichment eventually allows continuing with the existing profile. Draft generation
stops at the unavailable/quota boundary. A new manual draft editor/Preview could not be reached
after that failure; no successful generation, Preview, Share, automatic profile addition or Undo
is claimed by this persistent smoke pass. Their prior isolated tests and mock presentation
checks remain separate evidence. Google is disconnected; no Calendar/provider action occurred.

History's real payment/credit links exposed the old combined-route redirect opening Schedule.
The v2 presentation now maps those destinations to Billing and lesson destinations to Schedule,
while preserving v1's combined route.
The 13-test History suite, frontend typecheck and selected-v2 build pass after this fix. A real
browser click from the payment history entry now opens Billing with the persisted payment and
credit balance visible.

The playground and its data are intentionally left running for maintainer feedback. The populated
mock-auth preview on port 5174 remains useful for lesson-memory and profile-update presentation;
its mock state resets on reload. Neither environment changes production.

# Student Area MVP - Tomorrow Start Note

## Meta

- Audience: founder-maintainer + implementation agents.
- Date Captured: 2026-04-30.
- Intended Start: 2026-05-01.
- Status: archived.

## Summary

This note captures the next MVP-sized product push for the student area and adjacent prompt
editing, account, assignment, sharing, scheduling, billing, and hosting surfaces.

Treat this as a starting backlog for tomorrow, not as a final technical design. The first working
session should turn these items into ordered implementation slices with contracts, tests, and rollout
notes.

## MVP Backlog

- [x] 0. Restore prompt editing and prompt versioning.
  - A prompt editing/versioning feature existed before the transition to the current student area.
  - First slice: restore template editing/versioning as a top-level `/prompts` page.
  - Scope the rescue surface to prompt templates only; learner profile editing remains in the
    student Learning page.
  - Preserve version history, reviewability, rollback/reuse, and clear teacher/operator authority.
  - Keep the page aligned with prompt packages and the DB-canonical prompt-gallery/runtime prompt
    source.

- [x] 1. Implement real scheduling and billing.
  - Define the minimum useful scheduling model, billing/accounting model, and where those states
    live.
  - Keep scheduling and billing outside the pedagogical learner profile.
  - Durable product decisions are recorded in
    [`docs/reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md`](../../reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md).

- [x] 2. Fix the student area overview page layout.
  - Review the current overview route against the student-area design locks.
  - Improve scanability, spacing, and page hierarchy.

- [ ] 3. Design the student continuity model for open threads and persistent challenges.
  - Decide how student "open threads" are formed, carried forward, reviewed, and resolved.
  - Decide how persistent challenges are formed, carried forward, reviewed, and addressed in
    assignments.
  - Define how both concepts enter prompt packages without becoming noisy or stale.

- [x] 4. Clean up the profile candidates section on the student learning page.
  - Make candidate review less cluttered and easier to act on.
  - Preserve the rule that pending or rejected candidates do not affect live prompt packages.

- [x] 5. Redesign advanced actions and reruns in the minimal assignment flow.
  - Current advanced actions are too technical and visually rough.
  - Bring generalized rerun buttons up to the same correctness standard as custom mode with manual
    checkbox selection.
  - Verify that every rerun action does exactly what its label promises.

- [x] 6. Eliminate the choice of share destination.
  - HTML page publishing is the only target for now.
  - Retire or hide older Notion/Anytype-era destination choice from the active flow.

- [x] 7. Implement student archive or delete.
  - Decide whether MVP needs archive, hard delete, or both.
  - Preserve auditability and avoid accidental destructive deletes.

- [ ] 8. Broaden teacher accounts and student attachment.
  - Expand the account model beyond the current narrow teacher assumption.
  - Define how students are attached to teachers and how ownership/visibility should work.

- [ ] 9. Research hosting options.
  - Assess Vercel, Cloudflare, and Google Cloud Platform as realistic deployment targets.
  - Include both technical fit and financial fit.
  - Pay special attention to backend/runtime needs, database hosting, storage, queues, workers,
    secrets, and operational complexity.

- [ ] 10. Add email service and social signup research to the account expansion track.
  - Identify an email provider path for signup, transactional messages, and future reminders.
  - Research Google signup and similar identity-provider options.
  - Connect this decision to hosting and account model choices.

- [ ] 11. Suppress review-needed overview notifications for superseded profile drafts.
  - Superseded profile drafts should not surface a student overview notification that they need
    review.
  - Only current actionable profile drafts or candidates should contribute to review-needed
    overview signals.

- [ ] 12. Plan a teacher-wide schedule and stats hub.
  - Add a "My Schedule" page adjacent to the future teacher profile/account revamp where the
    teacher can see all scheduled lessons, reminders, payments, and related operations in one
    place.
  - Add a "Stats" page for monthly income, taught lessons/work hours, expected income adjusted for
    incoming payments and likely no-shows, and other teacher business-health signals.
  - Treat this as planning-only for now; implementation should follow a dedicated product/design
    discussion.
  - Core draft:
    [`docs/reference/TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md`](../../reference/TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md).

## Suggested Workstream Split

1. Product/UI repair:
   - prompt editing and versioning page restoration through `/prompts`
   - overview layout
   - profile candidates cleanup
   - advanced actions and reruns
   - share destination simplification

2. Student continuity:
   - open threads
   - persistent challenges
   - assignment prompt integration

3. Business operations:
   - scheduling
   - billing
   - teacher-wide schedule and stats
   - archive/delete students

4. Accounts and hosting:
   - teacher accounts and student ownership
   - hosting research
   - email service
   - Google/social signup

## First Session Questions

1. Prompt editing/versioning first slice is locked as a top-level `/prompts` page for template
   editing only.
2. Which track follows prompt editing/versioning: student continuity, UI repair, business
   operations, or hosting and accounts?
3. Should scheduling and billing ship as one slice, or should lesson scheduling/credits come before
   real billing?
4. For deleting students, is reversible archive enough for MVP?
5. Are open threads and persistent challenges separate canonical objects, or different lifecycles of
   one student-continuity model?
6. Does hosting research need to produce a decision, or just narrow the options and estimate costs?

## Guardrails

1. Do not put scheduling, billing, or reminder state into the learner profile.
2. Do not let pending/rejected profile candidates affect generation.
3. Do not restore prompt editing/versioning as an isolated admin island; it must align with current
   prompt-package and prompt-gallery/runtime prompt authority.
4. Do not preserve legacy Notion/Anytype sharing choices in the active MVP flow unless a deliberate
   compatibility reason is found.
5. Do not implement broad account changes without an ownership and visibility model.
6. Use test-driven development for behavior changes, especially prompt version selection, reruns,
   destructive student actions, and prompt-package continuity.

# Student Area Redesign Blueprint

## Summary

This topic defines a brand new student area for the batch frontend.

It does **not** treat the current student workspace as the target architecture. The current
workspace is a temporary operational surface that proved the backend slices, but it now mixes
pedagogy, workflow repair, template administration, and future business concerns into one page.

The new student area should become a long-lived product surface with four interconnected pages:

1. `Overview`
2. `Learning`
3. `Schedule & Billing`
4. `History`

This topic locks the product architecture, UX boundaries, and future-facing data domains needed for
the next few months of development.

## Why This Is A New Topic

Three separate products are currently entangled:

1. pedagogy and durable learner context
2. lesson operations and continuity
3. business operations such as scheduling, reminders, and payment accounting

That entanglement is now a bigger product risk than any single missing feature. This topic creates
one stable blueprint so later implementation can move fast without repeatedly re-deciding the same
page model, ownership boundaries, or profile authority rules.

## Locked Decisions

1. The future student area is a new multi-page product, not a cleanup pass on the current
   workspace.
2. `Overview` is a control-tower page for glanceability and navigation, not a dense editing screen.
3. `Learning` is the first polished deep page and the operational home for pedagogy.
4. The foundational learner profile becomes structured canonical data rather than freeform markdown.
5. The structured learner profile remains strictly pedagogical and must not absorb billing,
   scheduling, or reminder state.
6. The broader student record is split into separate domains:
   - student identity and relationship
   - learning profile
   - lesson operations
   - billing and attendance
   - history and provenance
7. LLMs may help draft or enrich profile data, but teacher authority remains explicit and easy to
   exercise.
8. Scheduling and accounting are future first-class surfaces, not sidebar appendices.
9. Future reminder delivery is Telegram-first because the bot ecosystem already exists, but the
   domain model should remain able to add email later.
10. Calendar planning is designed for hybrid bidirectional sync; the app should not assume calendar
    data is export-only forever.

## Topic Map

1. [phase-1-information-architecture-and-domain-boundaries.md](phase-1-information-architecture-and-domain-boundaries.md)
   - page map
   - domain split
   - navigation model
2. [phase-2-learning-page-and-structured-profile.md](phase-2-learning-page-and-structured-profile.md)
   - structured profile
   - teacher-authoritative editing
   - learning page UX
3. [phase-3-profile-generation-migration-and-prompt-packaging.md](phase-3-profile-generation-migration-and-prompt-packaging.md)
   - structured-output drafting
   - markdown-to-structured migration
   - prompt packaging
4. [phase-4-overview-page-and-cross-domain-summaries.md](phase-4-overview-page-and-cross-domain-summaries.md)
   - control-tower UX
   - summary cards
   - next-action design
5. [phase-5-scheduling-billing-reminders-and-history.md](phase-5-scheduling-billing-reminders-and-history.md)
   - lesson planning
   - lesson-credit accounting
   - reminders
   - chronology and provenance
6. [overview-page-design-lock.md](overview-page-design-lock.md)
   - Overview visual direction
   - loading and stability rules
   - operations rail model
   - Telegram avatar and 24-hour-time decisions
7. [history-page-design-lock.md](history-page-design-lock.md)
   - History visual direction
   - event-category language
   - timeline hierarchy
   - Telegram avatar and 24-hour-time decisions
8. [phase-6-shared-student-masthead-and-density-system.md](phase-6-shared-student-masthead-and-density-system.md)
   - shared student masthead
   - removal of duplicated page-local identity heroes
   - route-aware body density variants
   - directory-to-student identity continuity
9. [phase-7-unified-student-area-design-language.md](phase-7-unified-student-area-design-language.md)
   - shared student-area visual primitives
   - unified editorial teaching-studio styling
   - Learning and Schedule & Billing visual convergence
   - browser-level visual acceptance

## Current Authority Chain

Use the docs in this order when making student-area UX decisions:

1. Phase 1 owns page architecture and domain boundaries.
2. Phase 6 owns shared shell, masthead, tabs, route-level page density, and removal of duplicated
   page-local identity heroes.
3. Phase 7 owns the next visual convergence pass: shared design tokens, reusable primitives, and a
   unified look across all student-area pages.
4. The page-specific phase docs and design locks still own content contracts, but any older
   `header`, `hero`, `portrait`, or `back link` wording should be interpreted through Phase 6.

## Recommended Delivery Sequence

The product should be built in this order:

0. `Shared student masthead`
   - normalize the shell before further page polish
   - remove duplicated student identity heroes from routed pages
   - introduce route-aware body density for `Overview`, `Learning`, `History`, and
     `Schedule & Billing`
1. `Unified design language`
   - extract or centralize shared student-area visual primitives
   - bring `Learning` and `Schedule & Billing` into the same warm editorial system as `Overview`
     and `History`
   - verify the pages together in a browser, not just in isolated component tests
2. `Learning`
   - structured profile
   - manual editing
   - generated-draft helpers
   - minimal-flow preview integration
3. `Overview`
   - status cards
   - deep links into learning and future ops work
4. `History`
   - the least ambiguous future home for provenance that is currently cluttering the workspace
5. `Schedule & Billing`
   - start with lesson credits, next-lesson planning, and reminder state
   - expand later into invoices, attendance, and communication log

This sequence keeps the highest-value pedagogical work moving first while reserving the correct
future homes for the operational and business surfaces.

## Definition Of Done For This Topic

The student area redesign is only complete when:

1. the batch frontend has a dedicated student-area page model that matches this topic
2. the foundational profile is structured canonical data
3. the minimal assignment flow previews profile context without embedding profile editing inside the
   lesson-authoring flow
4. the student-area UX no longer depends on the current all-in-one workspace mental model
5. scheduling, billing, and history have clear product homes even if later slices ship them
   incrementally
6. docs and runtime terminology consistently treat the learner profile as pedagogical truth rather
   than a bucket for every student fact

## Relationship To Existing Docs

This topic extends, but does not replace, the current student-system documentation:

1. [`docs/reference/STUDENT_SYSTEM_ROADMAP.md`](../../reference/STUDENT_SYSTEM_ROADMAP.md)
   remains the high-level roadmap.
2. [`docs/plans/student-profile-enrichment/README.md`](../student-profile-enrichment/README.md)
   remains the detailed workstream for candidate facts and profile promotion.
3. The new topic becomes the authoritative product blueprint for the future student area and should
   be used whenever a change affects:
   - page structure
   - learner profile UX
   - scheduling and accounting direction
   - student-area navigation and surface ownership

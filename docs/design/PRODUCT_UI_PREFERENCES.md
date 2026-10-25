# Product UI Preferences

## Meta

- Audience: product designers, frontend engineers, maintainers, and implementation agents
- Authority level: active product-design guidance beneath [`PRODUCT.md`](../../PRODUCT.md)
- Evidence base: the July 2026 Step 1 resume-list design and implementation review
- Last verified: 2026-07-16
- Review cadence: after substantial practical use or another completed cross-screen UI review
- Status: active

## Purpose

This document translates observed design preferences into guidance for future ESL Pipeline screens.
It is not a component specification or a mandate to copy the assignment resume list everywhere.
Use it to preserve the product's preferred information hierarchy, density, interaction style, and
decision process while allowing each view to solve its own task.

The assignment-entry source still implements the referenced resume-list example, including a
collapsed lineage disclosure and labels derived from source-job relationships
([`AssignmentEntryStep.tsx`](../../packages/batch-frontend/src/ui/assignments/steps/AssignmentEntryStep.tsx)).
That source check confirms the example's current implementation only; it does not certify these
preferences against every current screen or turn them into universal UI requirements.

The desired register remains calm, precise, teacherly, and practical. The interface should feel like
a trustworthy working tool for a tutor, not a generic SaaS dashboard, an AI showcase, or a decorated
pipeline console.

## Durable Preferences to Reuse

### Make each region do one distinct job

Use the full width deliberately. A strong desktop composition often gives the left, center, and right
regions different responsibilities:

- left: identity, selection, or the stable object being acted on
- center: the most useful contextual fact for making the choice
- right: state, time, amount, or the immediate action

This is not a requirement for three columns on every screen. The reusable principle is that regions
should answer different questions. Do not fill open space with secondary prose merely to make a
layout look occupied.

When values form a repeated list, align comparable information to stable rails. Status labels,
timestamps, amounts, and row actions should not shift horizontally because another label is longer.
Alignment is part of scanability, not cosmetic polish.

### Prefer useful context over explanatory copy

Give prominent space to facts that help the tutor recognize or recover work: learner identity,
lesson context, saved workflow step, available artifact, date, or actionable state. Remove generic
reassurance and system narration when the interface already demonstrates the behavior.

Examples of low-value noise include:

- `Existing work is preserved` repeated on every row
- `Latest progress will be shown`
- a center label such as `Generation underway` beside a right-side `In progress`
- `Review the issue` beside `Needs attention`

One concept should normally appear once. Supporting text earns its place by adding a different fact,
not by paraphrasing the status or button.

### Anchor visible variance in real contracts

Prefer specific labels derived from data already guaranteed by the current contract. A saved step,
available draft, guidance artifact, publication state, or proven parent relationship is more useful
than a polished but guessed label.

Do not synthesize lesson names, topics, relationships, progress, or provenance from incidental
similarity. If a valuable field is unavailable, either omit it or propose the contract work
explicitly. Honest absence is better than plausible fiction.

### Make state obvious, restrained, and redundant in the accessible sense

Important state should be recognizable on the first scan through a consistent combination of:

- a familiar or easily learned icon
- a plain-language label
- restrained semantic color
- stable placement

Color should stay concentrated in the state indicator, selection border, or primary action. Avoid
tinting an entire row or card unless the whole surface genuinely represents an exceptional state.
Never rely on color or icon recognition alone.

Selection and state are separate concepts. Use the normal control vocabulary for selection and do
not let green, red, or blue status styling imply which item is selected.

### Use compact progressive disclosure for secondary depth

Show the small, high-probability set first. Reveal older, rarer, or more technical material through
an explicit inline control while retaining the current context. Favor page growth after a deliberate
action over an endlessly rendered list, nested scrolling region, modal, or archive-like interface.

When several records are versions of one object and the relationship is proven, group them as a
lineage. Keep the latest or most relevant version in the full row and reveal earlier versions in a
lighter history treatment. Do not repeat identity and shared metadata inside every version row.

Disclosure controls must look clickable. Compact pills are appropriate for a small count or bounded
secondary toggle when they have clear hover, focus, active, and expanded states. Pills are not a
general decoration or a replacement for ordinary buttons, links, filters, and labels.

### Keep the interface dense without making it cramped

Prefer compact rows with a clear reading order over tall cards containing several lines of weak
metadata. Use full cards only when the content is a genuinely independent object or needs a boundary
for interaction, not as the reflexive wrapper around every section.

Spacing, borders, and neutral surfaces should organize information quietly. Moderate radii, fine
borders, and little or no shadow fit the product better than floating panels, glass effects, large
corner radii, or decorative depth.

### Preserve the surrounding product while improving one surface

Make bounded changes that respect existing routes, shell, workflow steps, contracts, tests, and
component vocabulary. A focused redesign should not create visual drift in adjacent controls or
quietly change icons, terminology, or behavior that already works.

Reuse the Calm Studio tokens and established controls first. Introduce a new pattern only when it
solves a real information or interaction problem and can be named clearly enough to reuse.

### Treat responsive and locale behavior as part of the design

Do not validate a fixed rail only with short English sample data. Test long names, every status,
localized dates, narrow viewports, zoom, and expanded states. Prefer compact, stable formatting where
the precise field permits it; otherwise let content wrap or restructure the layout rather than hide
meaning behind unexplained truncation.

Responsive behavior should preserve information roles, not mechanically squeeze desktop columns.
When width is limited, move secondary context below the stable identity/state line and keep related
items visually grouped.

## Patterns to Abstain From

Avoid these unless a screen provides strong task-specific evidence for them:

- repeated status paraphrases across the row, button, and helper text
- speculative metadata or inferred relationships that the contract does not prove
- unbounded lists, automatic infinite scroll, or inner scrolling for a short decision step
- search, filters, pagination, or archive mechanics added before deep retrieval is a demonstrated need
- modals, drawers, or popovers when an inline reveal preserves context
- large grids of identical icon cards
- decorative badges, pills, icons, connector nodes, or color with no information role
- raw IDs, internal pipeline jargon, and technical diagnostics in the primary task path
- semantic color spread across entire inactive surfaces
- large shadows, glass effects, gradients, exaggerated radii, or ornamental animation
- copy that explains obvious UI mechanics instead of identifying the learner, lesson, artifact, or next action

The test is not whether a pattern is fashionable or polished. Ask whether it helps a tutor make the
current decision faster and with more confidence. If it mainly makes the interface look more like a
software product, leave it out.

## Context-Specific Choices, Not Universal Rules

The following decisions worked for the resume list but should not be copied mechanically:

- four initial lineages and eight-item reveals
- a fixed 156px state rail
- native radio selection
- the labels `Latest rerun`, `Previous rerun`, and `Original`
- a vertical history thread
- the `N versions` disclosure pill
- grouping through `sourceJobId`
- placing state specifically on the right

Reuse the underlying reasoning—bounded defaults, stable comparison, proven relationships, precise
selection, and visible disclosure affordance. Choose different numbers and controls when another
screen has different frequency, risk, data, or primary action.

## Preferred Design Process

For future UI work:

1. Start with the real user scenarios, their frequency, and the decision the screen must support.
2. Inspect current contracts and existing product vocabulary before proposing visible fields.
3. Assign each visible region a distinct information role and remove semantic duplication.
4. Explore a small number of concrete visual alternatives when alignment or hierarchy is the main
   question.
5. Preserve the strongest parts of the existing surface and constrain the redesign boundary.
6. Test the chosen direction with realistic data, all states, long localized strings, narrow widths,
   keyboard focus, loading, errors, and empty results.
7. Stop when the screen solves the observed problem cleanly. Record the reference and defer
   speculative polish until practical use exposes a real paper cut.

Screenshot annotation and direct comparison are especially useful for alignment, density, and
information hierarchy. Feedback should be converted into a general principle only after separating
the durable preference from the one screen's data and constraints.

## Review Checklist

Before accepting a new or revised product screen, ask:

- Can the primary object, useful context, current state, and next action be found on the first scan?
- Does each label add a new fact, or does it paraphrase nearby UI?
- Is every visible relationship and piece of metadata backed by a real contract?
- Are repeated values aligned consistently?
- Are selection, state, and action visually distinct?
- Is secondary depth progressively disclosed without losing context?
- Are controls visibly interactive in default, hover, focus, active, disabled, and loading states?
- Does the screen still work with long localized content and at narrow widths?
- Did the change preserve established product vocabulary around it?
- Would removing any decorative element leave the task equally clear? If yes, remove it.

## Source Record

The concrete decisions that produced this guidance are documented in
[`2026-07-16-assignment-resume-list-design.md`](../superpowers/specs/2026-07-16-assignment-resume-list-design.md).
That specification remains authoritative for the Step 1 resume list; this document carries only the
cross-screen lessons.

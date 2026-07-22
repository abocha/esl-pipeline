# Calm Studio Handout Visuals Design

## Meta

- Date: 2026-07-22
- Status: approved design
- Scope: default visual theme emitted by `@esl-pipeline/html-publisher`
- Excludes: markdown contracts, lesson content, emoji removal, and custom theme overrides

## Goal

Bring newly rendered student handouts into the Calm Studio product family without making a learner
document look like the tutor-facing application.

## Visual Direction

- Replace the warm beige and brown default palette with Calm Studio's cool near-white canvas, white
  surfaces, slate ink, restrained blue accent, pale-blue tint, and neutral borders.
- Preserve the serif handout title and frontmatter emoji as learner-facing warmth.
- Replace decorative gradients with flat surfaces. The editorial rail may keep a subtle fade because
  it communicates page structure rather than surface decoration.
- Reduce broad shadows and large radii. Handout panels may remain friendlier than application
  controls, with an 8-12px radius range rather than the app's 4-6px range.
- Retain dark mode, but shift it from brown-black to cool slate and keep blue as the interaction
  accent.
- Use typography and rules for section hierarchy instead of bordered heading capsules.
- Avoid nested panel chrome in the grammar comparison: the two comparison cards carry the grouping
  without an additional outer card.
- Keep lesson emoji intact while making disclosure controls, mobile metadata, and fixed controls
  feel consistent and touch-friendly.
- Respect reduced-motion preferences and avoid layout-property transitions.

## Implementation Boundary

The change stays primarily inside the renderer's default CSS and tests. `RenderOptions.theme`
continues to override the same public theme-token fields. The generated HTML structure remains
unchanged; the table-of-contents disclosure label changes from `Contents` to the more actionable
`Jump to section`, and the existing disclosure animation gains deterministic open/close sequencing.

Existing published handouts are immutable HTML artifacts and are not rewritten. Previewed and newly
generated handouts receive the revised defaults.

## Verification

- Add renderer assertions for the Calm Studio-derived default tokens.
- Add assertions that decorative gradients are absent from the body, hero, tags, callouts, contents
  shell, and grammar matrix while the structural editorial-rail fade remains.
- Add assertions for unboxed heading hierarchy, the flattened grammar comparison, consistent
  disclosures, touch targets, balanced rail geometry, and reduced-motion support.
- Run the focused HTML publisher suite, typecheck, and affected repository gate.
- Inspect representative light, dark, narrow, and print output in Chrome.

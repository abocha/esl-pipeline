# ESL-33 selected handout design QA

final result: passed

**Findings**

No actionable P0/P1/P2 drift remains against the selected design contract. The section markers,
plain-white grammar forms with continuous blue left rules, shared comparison surface/heading strips,
divider, vocabulary separators and selective mission emphasis are implemented in shared CSS.
Lesson values, components, generation policy, renderer identity, bindings and interaction scripts
are unchanged in this delta.

**Visual authority and evidence**

- Revised selected option 3: `D:/code/esl-pipeline/tmp/esl33-selected-design/selected-reference.png`
  (1487 × 1058 pixels). This includes the approved underline extended across the full heading block.
- Grammar left-rule reference: `D:/tmp/codex-clipboard-e48fbabd-2dea-4109-b9c3-e60e25a3cbb1.png`
  (588 × 192 pixels), inspected alongside the selected reference.
- Implementation: `http://127.0.0.1:5175/polish.html`, the existing complete lesson fixture.
- Evidence directory: `D:/tmp/esl-33-selected-design/`. Full final screenshots:
  `desktop-final-full.png` (1280 × 10063), `phone-final-full.png` (390 × 13999).
  Same-copy baseline: `desktop-before-full.png` (1280 × 10344),
  `phone-before-full.png` (390 × 14095), from the saved 3b96d09f document.
- Full-view comparison: `final-overview-reference-pair.png`. Focused comparisons:
  `final-heading-reference-pair.png`, `final-form-reference-pair.png`,
  `final-comparison-reference-pair.png`, `phone-comparison-reference-pair.png`.
  Reference and implementation appear together in each comparison; separate views were not used
  as a substitute for comparison.
- Same-copy desktop/phone region pairs cover transcript, forms, comparisons, vocabulary, practice,
  pronunciation, mission, answers and sample: `<device>-<region>-before-after.png`.
  Full pages also include the opening goal and every section heading.

**Viewport, density, state and adaptations**

All new implementation captures use Codex's in-app browser through `cua_repl`; no direct Playwright
CLI/MCP or external browser was used. Final CSS viewports were verified at 1280 × 1000 and
390 × 900. The browser's observed devicePixelRatio was 1.100000023841858. Native PNG viewport
captures were 1408 × 1100 and 429 × 990; they were normalized to the measured CSS dimensions and
stitched using the observed scroll offsets. This avoids clipping or viewport reflow during a full
page capture. Raw screenshots, scroll metadata and region boxes are retained. Early experimental
full-page/density captures are diagnostic drafts; only the final stitched captures support the pass.

The selected raster has no specified CSS viewport or density. Its body appears approximately
22 pixels; focused/source copies were scaled by 16/22 to compare with the unchanged 16px body.
This is an explicit visual normalization, not a claim of an exact font/viewport recovery. Reference
crops and implementation regions start at the same semantic boundaries. The full overview retains
their different heights instead of compressing or deleting lesson content to force alignment.

Transcript and answer key are expanded in both full-page baseline/final captures; grammar reveals
are initially closed. The reference is a shortened grammar excerpt: it omits the full explanation,
one form block, one comparison and several examples/traps. The complete lesson retains those
groups, so its region is taller. The reference's larger display text, proportional formula chips,
shorter explanation, different cue boundaries and platform emoji rendering were adapted to the
existing system-ui/monospace typography, authored cues, icons and 72ch reading measure. No copy
was shortened or re-marked. Wider comparisons/tables remain symmetric around the reading axis.
On phones, columns stack and the divider becomes horizontal. The same surface/heading language
extends to the unpictured parts of the lesson; these are contract-driven adaptations, not claims
of pixel identity with the excerpt.

**Comparison history**

1. First implementation: the combined heading comparison (`iteration1-heading-pair.png`) showed
   a P2 spacing mismatch. Main-grid margins added 16px below h2 and 20px above the following h3,
   leaving a noticeably larger empty gulf than the selected reference. The comparison/form surfaces
   otherwise followed the selected direction. Result at this point: blocked.
2. Fix: `.learner-handout main > h2 + h3` now removes the redundant h3 top margin; h3 bottom spacing
   is 8px. Recaptured the complete desktop/phone lesson and compared aligned reference regions again
   in `final-heading-reference-pair.png` and the final overview/form/comparison pairs. The heading
   now leads directly into the subsection and topic, with compact but distinct hierarchy.
   All final regions and the rest of the same-copy handout were inspected; no P0/P1/P2 remains.

**Required fidelity surfaces**

- Fonts/typography: inspected the normalized heading/form/comparison pairs and full-copy regions.
  Existing system-ui sans body and monospace authored cues are retained. Measured weights are
  400 body, 600 field/form/subsection labels, 700 main/topic headings. Main section 24px, subsection
  20px, topic 18.4px and form 16px give distinct roles; mobile main headings are 20px. Existing
  authored bold/italic and speaker emphasis remain. Line height 1.65 and cue wrapping remain readable.
  Different raster antialiasing/display scale is expected; no truncation or internal -ing break found.
- Spacing/layout: centered 72ch reading blocks, symmetrically wider comparison/table groups,
  left-aligned text and 16px mobile gutters retained. Blue rules span each whole form. Comparison
  title belongs inside its wide surface, heading strips align with their columns, and one modest
  divider separates columns; there are no nested column cards. Final paired crops confirm the
  corrected section rhythm and compact teaching groups. No phone page overflow was observed.
- Colors/tokens: white canvas; section rule #75a9d5, form/divider #a3c5e4, shared surface #edf5fc,
  column strip #d9e9f8, dark comparison heading #173e63. These match the selected restrained blue
  relationships. Existing bordered blue chips and amber error state remain distinct. No shadows,
  universal section fills, heavy borders or filled grammar forms were added.
- Image/asset fidelity: no photographic/illustration assets are present in the target. Existing
  section emoji and library playback icons are retained by explicit scope; no new icon set, raster
  background, illustration, app scaffold or asset library was introduced. Rules and surfaces are
  ordinary native CSS presentation, as specified by the approved contract.
- Copy/content: complete article text (including hidden answer/reveal content) matched the saved
  baseline exactly in the browser. All six transcript turns, three forms, two comparisons, five
  vocabulary entries, eleven practice questions/answers and the complete mission/sample remain.
  Source/lesson text was treated as evidence. No design-process language appears in learner output.

**Interaction and local validation evidence**

- In-app browser: Enter reveals only the first correction, focuses the revealed content, and leaves
  its explanation and other reveals hidden. `phone-reveal-focus.png` and `browser-checks.json` retain
  the evidence. Native transcript/answer disclosure controls still expand/collapse.
- In-app browser: temporarily blocked only the local tone URL to reproduce an audio failure via
  Space. The visible error and Retry remained; unblocking then Enter recovered to Replay with the
  error cleared. `phone-audio-error.png` and `phone-audio-recovered.png` retain those states.
  Temporary network overrides were removed. No JavaScript console errors were observed.
- The intact -ing chip, form alternatives and authored punctuation behavior remain; current
  39-test coverage includes cue/input preservation, independent reveal/focus and audio binding,
  retry/switch/stale-event behavior. No interaction JavaScript changed.
- `pnpm --filter @esl-pipeline/learner-handout fixture:static` passed.
- `pnpm --filter @esl-pipeline/learner-handout test:unit:prebuilt`: 39 tests passed in two files.
- Focused CSS Biome, changed Markdown Prettier, `git diff --check` and PR docs freshness checks are
  recorded in the accompanying ESL-33 evidence comment after their final run.

**Open questions and remaining limitations**

No unresolved design-selection questions. The retained-HTML full fixture recovers learner-visible
copy rather than canonical AssignmentV1 source; nonvisible metadata/teacher follow-up are local
placeholders and teacher rationale is null. Audio is a local tone, not speech. This pass covers the
in-app browser at the stated viewports; screen-reader, print, other-engine audits, hosted CI and
production verification were not performed. No push, PR, merge, deployment, provider call or
production/data mutation is authorized or performed.

**Implementation checklist**

- [x] Restore selected section markers and full-width underline.
- [x] Restore plain-white grammar form rules/inset and compact hierarchy.
- [x] Use one shared comparison surface, heading strips and adaptive divider.
- [x] Apply coherent vocabulary/goal/task emphasis throughout the unchanged full lesson.
- [x] Compare normalized source/implementation together; fix and recapture P2 spacing drift.
- [x] Preserve independent controls and keyboard/focus/error/retry behavior.
- [x] Keep full desktop/phone evidence and a usable local preview.

**Follow-up polish**

No P3 item is required for this approved delta. Platform font/emoji differences and the generated
excerpt's density are documented adaptations.

## Approved annotation delta after f1f81f2d

final result: passed

**Findings and approved target**

No actionable P0/P1/P2 mismatch remains in this bounded delta. The earlier selected reference and
comparison history above remain intact. The maintainer approved four specific changes to that
design: actual blurred text inside one clickable border with no visible Reveal label; standard
section 6 typography; a roughly 45px/57px desktop hero; and one connected transcript disclosure.
These annotations supersede the corresponding f1f81f2d presentation, not the selected layout as a
whole. Baseline visual truth is its saved complete document, `D:/tmp/esl-33-annotations/before.html`.
The selected option-3 reference remains the source for the unchanged rules/comparison surfaces.

**Capture and comparison evidence**

- In-app browser implementation: `http://127.0.0.1:5175/polish.html`; full existing lesson.
- Evidence directory: `D:/tmp/esl-33-annotations/`. Full baseline: `desktop-before-full.png`
  (1280 × 10063), `phone-before-full.png` (390 × 13999). Full implementation:
  `desktop-after-full.png` (1280 × 10208), `phone-after-full.png` (390 × 14383).
- Measured CSS viewports: 1280 × 1000 and 390 × 900, devicePixelRatio 1.100000023841858.
  Native viewport PNGs (1408 × 1100 / 429 × 990) were downsampled to CSS size and stitched by
  measured scroll offsets. Raw PNGs and scroll/region metadata are retained. Full-page states:
  transcript/answer key open, independent grammar answers closed.
- Source and implementation were inspected together in `desktop-hero-pair.png`,
  `phone-hero-pair.png`, `desktop-rationale-pair.png`, `phone-rationale-pair.png`,
  `desktop-transcript-pair.png`, `phone-grammar-pair.png`, and unchanged comparison/vocabulary/sample
  pairs. Same semantic crops and CSS scale avoid false drift from absolute scroll position.
  The full pages verify composition/density; focused pairs make the changes readable.
- State comparisons: `grammar-closed-hover-pair.png`, `grammar-closed-focus-pair.png`,
  `grammar-closed-revealed-pair.png`, `transcript-closed-open-pair.png`, and
  `long-closed-revealed-pair.png`. Closed/hover/focus screenshots were visually inspected: the
  soft blur conveys text shape but the answers remain unreadable. There is one crisp area per
  field, no visible instruction, Reveal label, icon or nested control.
- The long-answer probe uses a separate local clone with about 740 characters and authored cues;
  it does not replace or edit the full lesson. Both closed and revealed states wrap inside the
  phone reading area. The temporary probe is only supplementary layout evidence.

**Iteration history and fidelity surfaces**

The first annotation implementation passed the combined visual comparison. No substantive visual
fix was required after that comparison; formatting and selector-specificity cleanup preserved its
appearance. This is an additional passing iteration, not a repeat of whole-design ideation.

- Typography: unchanged 400 body / 600 labels-subheads / 700 main headings and authored emphasis.
  Desktop hero text measures 45px; icon font measures 57px. Mobile text is 32px and icon 40.5px.
  The emoji is sized relative to h1 (1.2667em), with flex-start alignment to the first title line.
  At 390px and 320px the complete title wraps without collision/overflow; section icons remain
  unchanged. Section 6 now computes exactly like the standard h2 at each width, including color,
  weight, line height, margins and underline; rationale computes to ordinary 16px/400 body color.
- Spacing/layout: each answer uses its actual text to reserve the eventual dimensions before
  activation. A small 8px/12px inset stays after activation, avoiding reflow while the border/wash
  disappears. All four full-lesson boxes retained identical dimensions after Enter/Space reveal.
  The long explanation retained 320.38px × 553.89px in both states with no page overflow. Initial
  document height increases because real answers now occupy space instead of short Reveal labels;
  this is an approved text-shape adaptation, not a new panel stack. Transcript content has a scoped
  16px inset inside its one frame; answer-key disclosure remains unchanged.
- Colors/tokens: existing blue palette/cue styling preserved. Closed answer text uses a static
  4px blur. One light control border strengthens blue on hover/focus with a faint wash; neither
  state changes blur or aria-hidden. Revealed fields have no control border/fill; keyboard focus
  retains the existing clear outline. Transcript has one light outer border, a borderless summary
  header and one quiet open-state separator; no nested frame. Section 6 no longer uses muted prose.
- Image/assets: existing hero emoji and playback library icons preserved; only the hero is scaled.
  No new imagery, assets, icons, animation effects or app infrastructure was introduced.
- Copy/content: same full lesson and conditional section-6 contract retained. Visible Reveal text
  is intentionally removed from the native buttons; descriptive accessible names remain. Actual
  answer text occurs once, with unchanged Inline escaping/cue rendering, and stays aria-hidden
  before activation. The long/hostile-input regression test verifies exact content and no mutation.

**Interactions and focused evidence**

- Hover and keyboard focus keep filter `blur(4px)` and `aria-hidden=true`. Actual screenshots
  confirm unreadability; measurements alone were not treated as visual proof.
- Enter reveals only the first correction; Space independently reveals its explanation. Each
  removes aria-hidden/blur, hides the sole native button and transfers focus to ordinary answer
  text. Other fields remain hidden/blurred. Dimensions are unchanged. A second activation cannot
  hide a previously revealed field. Existing delegation was reused without state/hydration changes.
- React/Vite full-lesson preview also verifies empty accessible controls, independent reveal,
  focus transfer, expected filters and no overflow. No JavaScript console errors were observed.
- Native transcript Enter/open/close states were checked. Existing interrupted-animation and
  reduced-motion tests still pass; those handlers were not edited. Answer-key styling is untouched.
- Browser print-media styles show unblurred answers, hidden reveal buttons and zero answer inset,
  preserving the existing print fallback. This is a print-style check, not a complete print audit.
- `pnpm --filter @esl-pipeline/learner-handout test:unit`: 40 tests passed across two files, including
  updated single-control/hidden-content assertions and a new long escaped/cue-content regression.
  Existing independent one-way/focus, native disclosure, audio binding/retry/stale-event and input
  preservation coverage passed. Static build/fixture emission passed.
- Focused Biome/Markdown formatting, diff checks and PR docs freshness results are recorded in
  the final ESL-33 evidence update. No broad gate or provider call was performed.

**Remaining limitations and checklist**

The earlier fixture-source, local-tone, screen-reader/other-engine, hosted-CI and production limits
still apply. CSS blur is a visual study affordance, not secret storage: the answer intentionally
exists in the document. Only the named learner controls and typography were changed; no public
data/generation/renderer-identity contract changed. No push, PR, merge or deployment performed.

- [x] One actual blurred answer and one empty, descriptively named native control per field.
- [x] Hover/focus stay unreadable; independent one-way Enter/Space and focus transfer pass.
- [x] Long answers wrap and reveal without size change; escaping/cues/print preserved.
- [x] Section 6 matches ordinary heading/body styles; conditional content untouched.
- [x] Responsive 45px/57px hero scales down and aligns with the first wrapped title line.
- [x] Transcript is one connected spoiler frame; native behavior and answer key preserved.
- [x] Full-copy/paired/state evidence inspected and focused checks passed.

No P3 follow-up is needed for these approved annotations.

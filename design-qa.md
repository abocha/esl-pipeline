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

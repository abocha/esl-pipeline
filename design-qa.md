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

## Approved stacked-field and shared-disclosure delta after 305cf3b9

final result: passed

**Findings and target**

No actionable P0/P1/P2 mismatch remains. The maintainer approved consistently stacked Corrected
and Explanation labels at every width, plus the transcript's connected frame on the Answer Key.
The selected option-3 design and all other annotations remain the visual authority. This is a
bounded implementation delta, with no new ideation, imagery or product infrastructure.

Source visual truth: `D:/tmp/esl-33-stacked-fields/before.html`, the retained 305cf3b9 complete
document. Implementation: `http://127.0.0.1:5175/polish.html`, also saved as `after.html` in the same
evidence directory. The full lesson, theme and interaction states match for the final comparisons.

**Captures and comparison history**

- CSS viewports: desktop 1280 × 1000 and phone 390 × 900, DPR 1.100000023841858. Raw viewport
  screenshots are 1408 × 1100 and 429 × 990. They were normalized to CSS size and stitched using
  measured scroll offsets; raw parts and region metadata remain in the evidence directory.
- Full baseline: `desktop-before-full.png` (1280 × 10208), `phone-before-full.png` (390 × 14383).
  Full implementation: `desktop-after-full.png` (1280 × 10365), `phone-after-full.png`
  (390 × 14670). Both disclosures are open and all grammar fields closed. The full composition
  pairs show the continuous document and the approved additional field/frame space.
- A first baseline capture had mismatched visible answer states. It was rejected, recaptured in
  explicit screen media with verified closed answers, and the comparison pairs regenerated.
  `baseline-state.json` records blur/aria-hidden and disclosure states. This was evidence repair,
  not a product design fix; no substantive fix was needed after the matching-state comparison.
- Source and implementation were inspected together in desktop/phone grammar pairs, transcript
  pairs, Answer Key head/middle/closed pairs and sample pairs. Full composition supports hierarchy;
  focused regions show label placement, text wrapping and the connected frame at readable scale.
- `desktop-grammar-state-pair.png`, `phone-grammar-state-pair.png`, `desktop-long-state-pair.png`
  and `phone-long-state-pair.png` compare actual closed and revealed states. Closed answers remain
  unreadable; revealed answers keep the same inset and line wrapping. The last keyboard-revealed
  answer retains the existing focus outline, not a permanent control border.

**Required fidelity surfaces**

- Fonts/typography: existing family, 400/600/700 weights, body size, cues, hero sizes, section
  markers and supporting headings remain. Corrected and Explanation consistently occupy a full
  label row above their value; Wrong remains the introductory sentence. No clipping/truncation.
- Spacing/layout: one grid rule gives both fields the same 6px gap. Their targets use the full
  available list width (597px desktop, 320.38px phone). The 8px/12px text inset remains unchanged
  before/after activation. Four normal fields retain identical widths/heights; the long probe
  retains 597px × 290.11px desktop and 320.38px × 553.89px phone. Page positions differ by less
  than 0.001px in readouts after focus scrolling; no layout shift or horizontal overflow occurs.
  Shared disclosure content uses the existing 16px side inset. Narrower answer prose is an approved
  frame adaptation; nested answer groups and the complete sample stay readable inside it.
- Colors/tokens: the existing light border, quiet open separator, hover wash and blue focus styling
  are reused. Both disclosures have one outer border, a borderless closed summary, a bottom-only
  open summary separator and borderless content. No double frame or new surface palette.
- Image/assets: existing emoji/library icons and their scale remain; no assets were added or replaced.
- Copy/content: complete article text matches exactly (including hidden answers and expanded
  disclosure content): 12,752 characters, recorded in `copy-checks.json`. Distinct transcript and
  Answer Key labels, all cue markup/escaping and original assignment input remain intact.

**Focused evidence and limits**

Native Enter/Space revealed all four fields independently at both widths, with aria-hidden removal,
focus transfer and hidden controls. Click revealed the long explanation while other fields stayed
blurred. Both disclosures were opened/closed with native Enter. `geometry-checks.json` and
`long-checks.json` preserve measurements and states. Print media shows no blur, hidden controls and
zero text inset; this is a style check, not a full print audit. Browser error log was empty.

`pnpm --filter @esl-pipeline/learner-handout test:unit` passed 40 tests across two files; static
build/fixture emission passed. Existing accessibility, independent one-way reveal, cue escaping,
input preservation, interrupted/reduced-motion disclosure and audio lifecycle tests were reused.
No component state or handler changed. Focused lint/format/diff and docs freshness checks are
recorded in the final ESL-33 evidence. Earlier fixture-source/other-engine/screen-reader/audio and
hosted/production limits still apply. No broad gate, paid-provider call, push, PR, merge or deploy.

**Implementation checklist**

- [x] Both label rows and full-width targets use identical deliberate gap/inset rules.
- [x] Closed/revealed short and long geometry/wrapping are invariant at desktop and phone widths.
- [x] Single blurred targets and existing interaction/accessibility/print behavior remain.
- [x] Transcript and Answer Key share one presentation class with no duplicated styling.
- [x] Native closed/open frames, nested answers and sample are readable without double borders.
- [x] Matching-state source/implementation comparisons passed; complete copy and selected design retained.

No P3 follow-up is required for this approved delta.

## Approved next annotations and selected Lucide markers after cc241d22

final result: passed

**Findings, selection and scope**

No actionable P0/P1/P2 difference remains. Three confirmed edits remove structured Pattern labels,
fill the native players' containing widths and emphasize the pronunciation sentence/audio group.
Two real full-lesson icon experiments were created. The maintainer then selected Lucide, authorizing
its adoption in the shared source, and subsequently requested a 12px Wrong-text inset to align with
revealed text. Both annotations are implemented. Emoji remains an unselected disposable experiment.
The seven h2 wordings are unchanged; the proposed shorter copy is pending selection.

Source visual truth: `D:/tmp/esl-33-next-annotations/before.html` retains cc241d22. The selected icon
target is `polish-icons.html` in that directory, with the later Wrong-inset annotation superseding
its text edge. `confirmed-only.html` retains the three-change stage before icon adoption.
Implementation: `http://127.0.0.1:5175/polish.html`, saved as `after.html`. Existing option-3 layout,
hero/section typography, grammar rules/comparisons and full lesson remain the target outside this delta.

**Capture and comparison history**

- Evidence root: `D:/tmp/esl-33-next-annotations/`. CSS viewports are 1280 × 1000 desktop and
  390 × 900 phone. Baseline/selected native PNGs are 1280 × 1000 / 390 × 900 at DPR 1; icon trials
  are 1408 × 1100 / 429 × 990 at DPR 1.1. Trial images are downsampled to CSS dimensions before
  comparison. `capture-dimensions.json` records raw/full dimensions and density for every stage.
- Full baseline: `desktop-before-full.png` (1280 × 10361), `phone-before-full.png` (390 × 14692).
  Full selected implementation: `desktop-selected-full.png` (1280 × 10154),
  `phone-selected-full.png` (390 × 14540). Both disclosures are open and grammar answers closed.
  Full composition pairs retain continuous-document evidence; readable focused pairs inspect the delta.
- Source and implementation were inspected together in desktop/phone forms, native study-audio,
  pronunciation and grammar pairs. `*-grammar-emoji-icons.png` shows the two experiments together;
  `*-grammar-target-selected.png` and `*-key-target-selected.png` compare the selected trial against
  the shared implementation. Closed/revealed pairs cover both trials and selected source at both widths.
- A forced-DPR capture produced clipped/duplicated stitched regions and was discarded. Selected
  screenshots were recaptured at native viewport sizing; final pairs show complete regions. Density
  normalization and small device rounding differences are documented rather than treated as design drift.
  No substantive design fix was required after the final matching-state comparison. The user-requested
  Wrong inset is a new approved annotation, not an unsolicited redesign.

**Required fidelity surfaces**

- Fonts/typography: existing family, 400/600/700 hierarchy, hero size, fixed h2 copy and authored
  emphasis remain. Only structured Pattern UI text is omitted; legacy Form still renders. Formula
  cues, comma/semicolon boundaries and rows remain exact. Sentence prose is ordinary body text,
  with only its field label emphasized; the rest of pronunciation instructions stay unchanged.
- Spacing/layout: formulas align with their form headings/examples. Native players fill their
  figure widths (desktop Study 621px, sentence 586px; phone Study 343px, sentence 308px in the
  measured scrollbar-containing viewport). The sentence and primary audio form one 16px-padded
  callout. Lucide markers use a 28px gutter/12px gap; reveal text retains 8px/12px padding.
  Wrong, Corrected and Explanation actual text edges all measure x=374 with a 557px text measure
  on desktop, x=68 with a 279px measure on phone. Wrong-only horizontal padding matches wrapping;
  answer-key prose is not padded globally. Closed/revealed boxes retain identical position, width,
  height and padding; no horizontal overflow. Item separation and explicit list semantics remain.
- Colors/tokens: existing pale-blue mission language and blue rule are reused for sentence focus.
  Cross/check/question markers retain the selected muted red/accent-blue/muted-slate colors.
  Actual blurred targets keep a single light border and existing hover/focus feedback; revealing
  removes blur/control while keyboard focus retains its outline. Connected disclosure frames remain.
- Image/assets: existing `lucide-react` X/Check/HelpCircle SVGs are used, 22px with stroke width 2,
  inside aria-hidden decoration. No generated mock, custom SVG drawing, new icon dependency or
  replacement hero asset. Requested emoji was used only in the disposable unselected trial.
- Copy/content: authored article text matches baseline and both variants after excluding the three
  approved Pattern UI labels, marker labels and their UI-only separator whitespace. Fixed headings
  also match exactly (`copy-checks.json`). All 29 field roles retain English accessible labels;
  reveal buttons retain descriptive names, with no visible instructional text or icon inside them.

**Focused evidence and limitations**

- Final marker source passed 40 tests across two files, including updated semantic marker assertions,
  independent one-way/focus/aria-hidden reveals, long hostile cue input, canonical input preservation,
  legacy Form, native disclosures/reduced motion and existing audio lifecycle regressions.
  The last Wrong-only CSS inset reused that passing behavior evidence; final build/fixtures, browser
  alignment and focused Biome were rerun for its actual risk, without an unrelated suite rerun.
- Static build/fixtures passed. Both native players fit their actual containers. All six modes and
  null pronunciation were inspected on phone; five sentence-bearing modes receive the same grouping,
  minimal-pair/null retain no sentence, and unavailable primary audio retains its placeholder.
  Legacy Form was also inspected on phone. No canonical fixture or renderer identity changed.
- Trial and source native Enter/Space reveals passed at both widths. Source dimensions remain invariant;
  actual text edges/wrap widths match after Wrong inset. React/Vite shows the same 29 decorative
  markers/accessible labels, independent reveal/focus and no overflow. Browser error logs were empty.
- Print style checks show ordinary unblurred answers, hidden buttons and zero answer/marker top inset.
  This is not a complete print or screen-reader audit. Local tone remains control evidence, not speech
  quality. No broad gate, hosted-CI claim, paid-provider call, push, PR, merge or production mutation.
- Only the development server allowlist gained the two exact temporary trial filenames. Trial markup,
  CSS and generation helper remain ignored local evidence/output; the selected semantic marker seam
  is private to renderer primitives, with no persistent assignment option or public configuration.

**Implementation checklist**

- [x] Structured formulas omit Pattern; legacy Form and canonical strings/rows remain.
- [x] Native study/sentence players fill containers and fit phone widths.
- [x] Existing sentence-bearing modes share a readable sentence/audio callout; absent/null stays absent.
- [x] Two interactive full-lesson trials captured; selected Lucide adopted in React/static source.
- [x] Accessible labels, decorative markers, list semantics and independent stable reveals preserved.
- [x] Wrong text aligns with revealed text; only its grammar-trap value receives the added inset.
- [x] Matching viewport/state comparisons and focused checks pass; h2 copy remains pending.

No P3 polish is required for the approved scope. Pending heading copy is a maintainer decision.

## Approved heading copy after 61e86c81

final result: passed

The maintainer approved all seven headings: Your Goal; Listen and Read; Grammar and Vocabulary;
Practice; Your Turn; Why This Helps; Answers and Example. This resolves the pending copy decision
above. Numbers, emojis and section IDs remain stable. Practice is fixed with or without pronunciation;
its pronunciation subsection remains unchanged. Section 6 retains its existing legacy/new-shape
visibility contract, and section 7 retains number 7. Authored content and subsection/disclosure labels
are unchanged. No actionable P0/P1/P2 or P3 finding remains in this approved delta.

Evidence is in `D:/tmp/esl-33-next-annotations/headings/`: `before.html` preserves the prior selected
implementation; `after.html` is the rebuilt shared static output. `desktop-opening.png`,
`phone-opening.png` and `phone-grammar-heading.png` were visually inspected at CSS viewports
1280 × 1000 and 320 × 900. `checks.json` records exact heading text/IDs, dimensions, unchanged
subsection/disclosure labels and no horizontal overflow. All desktop headings remain one line;
Grammar and Vocabulary wraps cleanly to two lines at 320px, with the other phone headings one line.
Existing typography, colors, spacing, assets and interaction QA from the selected implementation
above remains applicable. This is the requested heading wrapping/numbering spot check, not a new
full-page screenshot matrix or expanded QA pass.

Focused evidence: 40 unit tests passed across two files, including exact approved headings with and
without pronunciation, legacy/new rationale visibility and stable section 7 numbering. Static build
and fixture re-emission passed. Focused Biome passed after formatting the updated expectation.
README and this QA history reflect the resolved decision. The normal local preview remains
`http://127.0.0.1:5175/polish.html`. No input fixture, public assignment contract or authored lesson
content changed. No broad gate, hosted-CI claim, provider call, push, PR, merge or production mutation.

## Selected subheading copy and Lucide icons after 38da850f

final result: passed

The disposable full-lesson subheading experiment was selected with explicit final overrides.
Key Language You Will Use and the Answer Key disclosure retain their exact labels. The vocabulary
heading becomes B. Vocabulary, comprehension answers become Understanding Answers, optional extension
becomes Extra Task and Source Link becomes Source. All other enumerated trial copy is adopted.
Only the five existing fixed h3 emojis become decorative ListChecks/ScanText/BookOpen/PencilLine/Mic
icons. Their words are Check Your Understanding; A. How the Grammar Works; B. Vocabulary;
A. Practice Exercises; B. Say It Clearly (≈1 min). A/B prefixes, accessible names, h2 copy/emojis,
authored hero and the previously selected semantic field icons remain. No actionable P0/P1/P2 or
P3 difference remains in the approved delta.

The selected visual target is `D:/tmp/esl-33-subheading-selected/selected-target.html`: the retained
disposable trial with the four present final copy overrides applied. Shared static source is the
normal `http://127.0.0.1:5175/polish.html`, saved as `after.html` in that evidence directory.
Whole article text and control attributes match the selected target exactly, recorded in
`copy-controls-checks.json`. Existing tests cover Source, Extra Task and the equivalent natural
sentence label, which are absent from the canonical full-lesson trial. No canonical fixture was edited.

Matching captures use 1280 × 1000 desktop and 320 × 900 phone CSS viewports, DPR 1. Opening,
grammar, pronunciation/practice and open answer regions are retained as raw PNGs and eight
`*-pair.png` comparisons. Transcript and grammar reveals are closed in the captured comparison.
The compared regions preserve typography, colors, spacing, borders and assets outside the requested
copy/icons. Icons are 22px/stroke 2, with 8px gaps and the existing quiet blue accent; baseline and
wrapped text alignment match the selected trial. No horizontal overflow occurs at either width.
The phone grammar h2 wraps to two lines and Say It Clearly fits one line. Browser checks retain
exact heading names and aria-hidden/nonfocusable 22px icons. This is the requested representative
comparison, not a full-page/mode/print or screen-reader audit; prior selected layout evidence remains.

Focused evidence: all 40 existing tests passed across two files after updating expectations, including
authored-content/legacy preservation, rationale visibility, stable section numbering, Source/Extra Task
paths, all pronunciation modes and existing reveal/audio lifecycle behavior. Build and static fixture
re-emission passed. Shared-source phone checks also passed Answer Key closing, Transcript opening,
independent Enter/Space reveals with hidden state removed and focus retained, local pronunciation
playing state and empty browser error logs (`interaction-checks.json`). Local tone verifies controls,
not speech quality. The main preview was restored to its normal viewport with closed disclosures.

The five-heading JSX helper is private to LearnerHandout; no public option, generic framework,
dependency, assignment shape or renderer/publication identity changed. Scripts and the tracked fixture
server are untouched. The coordinating task restarted the main preview server; this task re-emitted
its files without operating that server. README reflects the final selection. No provider call,
production/data mutation, push, PR, merge, deployment or hosted-CI claim.

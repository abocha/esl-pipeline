# @esl-pipeline/learner-handout

React learner components and the sole deterministic, unhydrated Node document renderer for native
AssignmentV1 preview/publication (renderer 3). **`html-publisher` remains the publication authority**
for renderer identity, HTML artifact hashing, object keys and S3 uploads. Vite is development-only.

## Ownership and component organization

Runtime dependencies are React, React DOM, Lucide icons and `contracts`, which owns the bounded inline-text
convention as well as AssignmentV1 types. The package has no operator frontend, authentication, backend, orchestrator, storage,
upload, provider or TTS dependency. Keeping it separate from `batch-frontend` avoids tutor application
providers/routing. Keeping it separate from `html-publisher` allows presentation to evolve without
inheriting upload or publication-version responsibilities.

`LearnerHandout.tsx` composes the full seven-section surface, with local input/toolkit/practice/answer
components. `Pronunciation.tsx` handles the six existing modes. `primitives.tsx` owns escaped plain
text, fields, native disclosures, audio and safe source links/video. Domain text is escaped; ordinary
inline text uses only paired-backtick linguistic highlights. Formula fields also have the bounded
cue fallback described below. Neither path interprets HTML or general Markdown.
Section 6 renders only new-shape `learnerRationale`. Legacy root `rationale`
is audience-ambiguous, so section 6 is omitted entirely. `teacherRationale` is retained in typed data
and never emitted into learner HTML, including attributes, scripts, comments or serialized data.
Section 7 remains stable; section 8 is removed. `teacherFollowUp` stays typed teacher-only data
and is never emitted, even hidden or serialized.

Authored `metadata.instructionLanguage` sets the language of the static HTML document and shared
React article. English target text and fixed English presentation labels are marked separately;
comprehension questions (including answer-key copies), authored explanations and vocabulary meanings
use the support language. Comprehension answers and controlled-practice prompts/answers remain
explicitly English. This does not translate
the fixed UI labels. Missing metadata falls back to English in static presentation without inserting
fields into older assignments or changing canonical data.

Russian support metadata can accompany older English comprehension questions. For these question
texts only, the renderer uses a bounded heuristic: a Cyrillic character retains the authored Russian
language tag; otherwise the question is tagged English. The same rule applies to answer-key question
copies. Explanations independently inherit the support language and target answers stay English.
This is script-based presentation guidance, not general language detection; mixed text and other
support languages are not classified by this rule.

Section 5 renders the structured mission as one emphasized task callout, followed by lightweight
Prepare, Include in your response, How to do it and Before you finish headings with lists or text.
Empty lists and null delivery omit their headings. Optional extension stays inline; sampleResponse
stays in section 7's answer key. Legacy task/extension/sampleResponse objects render directly with
no inferred roles or data mutation. The single-column layout uses the existing responsive shell.

Grammar topics use headings and overall explanations, followed by lightweight form sections with
labels, patterns and examples. Each comparison is one labeled group containing exactly two
alternatives with their own label/example/meaning explanation. They sit side by side on desktop
and stack within the same group on mobile. General examples and uses appear only when populated;
Wrong, Corrected and Explanation trap lines remain distinct. Legacy scalar forms render directly
without inferred blocks or data mutation.

## Public seam

```tsx
import { LearnerHandout } from '@esl-pipeline/learner-handout';
import { renderLearnerHandoutDocument } from '@esl-pipeline/learner-handout/server';

const inputs = {
  assignment, // validated AssignmentV1, unchanged
  media: {
    studyTextAudioUrl: 'https://media.example/study.mp3',
    pronunciationAudio: {
      primaryClip: {
        id: 'caller-owned-primary',
        kind: 'primary',
        text: 'Sentence',
        url: primaryUrl,
      },
      itemClips: clips,
    },
  },
  publication: { displayDate: '6 October 2026' }, // optional, caller-formatted text
};

const html = renderLearnerHandoutDocument(inputs); // synchronous complete document
// <LearnerHandout {...inputs} /> renders the same tree in a browser.
```

The exported `LearnerHandoutProps`, `HandoutMediaInputs` and `PronunciationClipInput` describe a
presentation projection, not a new persisted media contract. Clip IDs, kind, index, text, optional
label and URL come from the caller. Existing audio payloads are structurally compatible with this
projection; planner/provider fields are ignored. Pair controls match item index **and side**, so
duplicate words do not change playback binding. Missing or unsafe URLs disable item controls.

URLs admit HTTP(S) without credentials and explicit relative paths; protocol-relative paths,
unsafe schemes, control characters and markup delimiters are rejected. Video frames use explicit
YouTube/Vimeo embed hosts; other safe video URLs remain links. Render never infers an origin.
Callers must resolve relative media paths alongside the saved document, or supply absolute URLs.

The Node subpath loads package-owned CSS/behavior bytes using Node filesystem APIs. It imports no
browser entry, Vite module loader or CSS import. Build the package once with
`pnpm --filter @esl-pipeline/learner-handout build`; render each assignment as a content operation.
There is no Vite build per assignment. No clock, timezone conversion, environment URL lookup, network
request, random ID or input mutation is involved. A date is omitted unless explicitly supplied.

## Styles and static behavior

`src/handout.css` is imported by Vite and copied alongside compiled Node JS during the package build.
The server inlines that CSS and `src/pronunciation-playback.js` and `src/handout-interactions.js`, producing a standalone document with
no external style/script dependencies. Only trusted package assets use raw HTML insertion; all render
inputs pass through React escaping and URL admission.

`<details>` and audio controls remain native. The small vanilla script handles delegated item-clip
playback, pauses a previous item clip, and reports Play / Playing… / Replay / Retry in the triggering button.
Switching resets the prior control; stale events cannot overwrite current playback state. Vite imports the
same script. Static output has no React bundle, event handlers, hydration or client application.
This establishes current playback only; it does not decide a general client-runtime architecture.

## Local fixture loop

```sh
pnpm --filter @esl-pipeline/learner-handout dev
```

Open `http://127.0.0.1:5174`. Edit a learner component or stylesheet for HMR; assignment data requires
no regeneration. Fixture selectors cover all six modes, pronunciation-null, and available/mixed/
unavailable audio. They reuse the contracts representative assignment and the existing native renderer
test patterns. `public/fixture-tone.wav` is a local 0.5-second 440 Hz test tone, **not pronunciation
speech**. It tests media plumbing without providers. Authentic attribution/video behavior also has
focused tests.

```sh
pnpm --filter @esl-pipeline/learner-handout fixture:static
pnpm --filter @esl-pipeline/learner-handout fixture:serve
```

The first command emits 23 complete documents and the local tone into `out/learner-handout`, through
the compiled Node renderer. Each HTML can be opened directly with its sibling tone file. The optional
second command serves only those fixture files on `http://127.0.0.1:5175`; it uses no Vite and has no
production role. `/` opens `shadow_sentence-mixed.html`. Names are `<mode>-<audio>.html`, including
`none-available.html` and `shadow_sentence-unavailable.html`. `grammar.html` uses the separate compact
structured grammar fixture: present simple vs continuous, two form blocks, one paired routine vs
temporary contrast, distinct time-frame guidance and a missing-be trap.
`polish.html` uses the full ESL-33 lesson in `preview/full-lesson.json`. Vite exposes the same
content through its ESL-33 polish fixture checkbox. All audio remains the local test tone.
The fixture was reconstructed from the retained published HTML artifact
`0516b4c0e63934fcf0f5849ddbe0b08634913ebf935011fa4e2960187cbcf5bb`: all learner-visible strings,
authored cues, six dialogue turns, three form groups, both comparisons, five vocabulary entries,
eleven practice items and their answers, and the full mission/sample are preserved. Speaker IDs,
roles and other hidden speaker metadata are local placeholders; teacher follow-up is a placeholder
and teacher rationale is null. This is a presentation fixture, not recovered canonical source or
generation-policy evidence. Original unmarked bracket hints stay unmarked; separate authored-cue
tests exercise punctuation without backfilling this lesson.

## Focused evidence

```sh
pnpm --filter @esl-pipeline/learner-handout test:unit
pnpm --filter @esl-pipeline/learner-handout typecheck
```

Tests cover the full surface, ESL-21 presentation invariants, all six pronunciation modes/null,
literal hostile text, URL/media safety, unchanged inputs, repeated byte equality, different mocked
clocks, and compiled plain-Node execution with DOM absent, network/clock/random reads prohibited and
three host timezones. The static behavior is exercised without React hydration. The prebuilt test
command expects `build` to have run (as in hosted build/unit lanes).

ESL-22 local inspection on 6 October 2026 covered Vite and emitted Node documents at desktop
(1280 px) and mobile (390 px), expanded transcript/answer key, pronunciation present/null and audio
available/unavailable. All six modes were inspected in both surfaces: `shadow_sentence`,
`minimal_pair`, `connected_speech`, `intonation`, `rhythm_chunking`, `sentence_stress`; none were
omitted. Playback completed using the local tone, unavailable controls stayed disabled, and native
disclosures exposed the expected reading/answer order. No page overflow or obvious surface divergence
was found; the vocabulary table scrolls within its own region on mobile. Component and stylesheet
HMR were verified while retaining the selected pronunciation-null fixture. This is rendering/control
evidence, not validation of provider speech quality. The existing ESL-20 frozen-artifact suite and
ESL-21 string-renderer suite also passed without changing the snapshot, pinned hash or production code.

The html-publisher adapter passes study audio, pronunciation primary/item clips and preview state
explicitly. Structured primary URLs take precedence over the separate URL fallback. h2/h3 preset
colors remain accepted hex presentation inputs; heading markers use the shared blue palette rather
than those theme colors. Broader legacy theme and feature options are retired. Preview missing-audio placeholders say "Audio track generating...";
publication unavailable states and disabled item controls remain explicit. Teacher’s Follow-up Plan is removed from learner output; both teacher follow-up and rationale stay
in typed teacher data. Static/Vite fixtures use the separate
structured mission fixture (including learner/teacher rationale); the ESL-20 legacy fixture,
ESL-24 rationale fixture and identity baseline remain untouched.

ESL-25 local inspection on 6 October 2026 covered the complete representative mission through the
compiled standalone renderer at 1280 px desktop and 390 px mobile. The task remains visually primary,
supporting roles wrap in a single column, and neither viewport has page-level horizontal overflow.
Focused DOM tests cover all roles, independently absent roles, a minimal mission, both legacy read
forms, escaped role text and unchanged inputs. No provider call or template activation was used.

ESL-26 local inspection on 6 October 2026 covered the emitted `grammar.html` at 1280 px desktop and
390 px mobile (CSS pixels). Form labels, patterns and examples remained scannable; comparison
alternatives stayed paired side by side or stacked within one group. Explanations and trap lines
wrapped with no horizontal overflow. Screenshots are retained locally in ignored
`tmp/esl26/grammar-desktop.jpg` and `grammar-mobile.jpg`. Only the changed grammar surface was
inspected; no pronunciation/media matrix, provider call or template activation was repeated.

The package ships only `dist`, including CSS and playback JavaScript. React/React DOM are runtime
dependencies. Production builds traverse the workspace graph; orchestrator keeps publication
external to its bundle to preserve package-relative asset lookup.

## First-real-handout polish (ESL-32)

Vocabulary expressions always render bold and examples italic, including highlighted fragments.
`Inline`, `Text` and `Field` share contracts' paired single-backtick convention; direct learner
strings and answer copies use it too. Unmatched delimiters stay literal, hostile text is escaped,
and long fragments wrap. Part titles have one renderer-owned number. The hero uses `metadata.icon`
or a display-only 🎧 fallback; no input is rewritten. Source presentation is Listen first, existing
audio then freely available transcript, with attribution/links and quieter generation provenance.
Pronunciation mode is internal. Its existing natural/shadow sentence and audio sit in a callout.

Each grammar correction/explanation has a visible semibold label and independently hidden content
with `aria-hidden` until its native reveal button is activated. Activation reveals once, removes
that button from tab order and preserves keyboard focus on the now-readable line. It never exposes
another line. A simple print rule exposes the content. No reveal state survives reload.

The packaged interaction script also animates shared native details in both directions using Web
Animations, cancels interrupted animations from the current height, clears clipping on completion,
and uses native behavior under reduced motion or without animation support. Native summary clicks
include Enter/Space keyboard activation. There is no hydration or general interaction framework.

Fresh schema/template identity is v8; see [the canonical contract](../../docs/reference/ASSIGNMENT_V1.md#learner-handout-convention-and-authored-emoji-esl-32).
Renderer 3 remains the native architecture identity; changed HTML gets a new exact-byte publisher
hash. Frozen fixtures/snapshots are unchanged. The local fixture deliberately demonstrates selective
highlights, wrapping formulas, numbered authored titles and an emoji using only local audio.

## Visual and cue follow-up (ESL-33)

Grammar `pattern`/legacy `form` fields always render as escaped cues, even without authored
backticks. Unmarked clause chunks separate at commas; semicolons and newlines start alternative
rows. Explicitly marked fragments retain their authored boundaries, including internal punctuation.
This transformation is confined to formula presentation and never rewrites canonical strings.
Ordinary inline content still requires explicit backticks; parentheses alone do not imply a cue.
Blue bordered cues are atomic inline boxes: short endings stay together while long formulas wrap.
Directly adjacent parentheses around an explicitly authored cue share its inline group but retain
ordinary text styling. Long grouped cues still wrap; plain parenthetical prose is untouched.

The shared layout uses one continuous white canvas without an outer frame or filled section bands.
Main sections have a blue vertical accent beside the heading and a thin blue underline across its
full content width. Header, section/subsection headings,
prose, transcript, practice, mission and answers share a centered 72ch reading column within a
1040px outer maximum. Comparisons and vocabulary expand symmetrically around the same axis;
comparison titles sit inside the shared pale-blue surface and align with its contents. Each column
has a darker pale-blue heading strip, with one quiet divider between columns. Grammar forms use
a blue left rule spanning heading, formula and examples on white, with a consistent inset.
Vocabulary has light row separators without cell grids/fills. Text remains left-aligned, with one
consistent list indent and no extra disclosure/sample inset. Phones use 16px side gutters and
stack comparisons/vocabulary, changing the comparison divider to a horizontal rule. Compact
section/subsection spacing and stronger topic headings carry the hierarchy; selective goal/final-task
surfaces retain mission emphasis. Listening, transcript, practice, answers and sample remain quiet.
Practice and answers
use 400-weight body prose, 600-weight field labels/subheadings, and 700-weight main headings.
Part numbers and titles share size/weight; explanation prose keeps the body size. Authored emphasis
in vocabulary, examples and transcript speakers remains distinct. Each reveal has one labeled
native button covering the actual blurred answer text, with a single light border and no visible
label/icon or nested control. Hover/focus strengthen the border without removing blur; activation
reveals once and hides the control. Answer text retains its reserved space/inset to avoid a reveal
layout jump, and print shows ordinary unblurred text. Descriptive accessible names, independent
aria-hidden answers and keyboard focus transfer remain.

The hero title scales to 45px with its existing emoji at approximately 57px; phones use 32px text
and a proportional 40.5px icon. A flexible first-line alignment lets long titles wrap beside the
icon rather than collide with it. Section 6 uses ordinary h2/body styling, retaining its existing
conditional-rendering contract. Only the transcript disclosure has a connected light border:
summary is its header and the expanded transcript sits inside with a quiet separator. The answer
key keeps its own existing disclosure styling.
Vocabulary uses balanced desktop columns and stacked narrow-screen rows. Explicit table roles,
column-header associations and English target annotations remain; mobile field labels are visual
duplicates excluded from assistive text. Teacher-only content remains absent from the whole document.

Clip buttons show Lucide play/speaker/replay/retry icons. Accessible names, tooltips and a visually
hidden live status describe each action/state. Switching resets the previous icon and late events
cannot overwrite current state. Native full-track players and preload semantics remain unchanged.
Failure also shows "Couldn't play audio." and a visible Retry label on the triggering button;
retry/switch clears that feedback through the existing guarded state transition.

The 7 October 2026 follow-up compared the same full reconstructed lesson before/after at 1280px
desktop and 390px phone widths, with transcript and answers expanded. All 144 inline fields and
three patterns matched the retained original text. Computed styles confirmed body/label weights,
matching part numbers/titles and 16px explanations; page scroll width matched each viewport.
A separate 355px authored-cue probe confirmed attached uncolored parentheses, intact `-ing` and
wrapping long cues. Keyboard reveals and local missing-clip failure followed by tone recovery
were inspected. Screenshots and computed-style results are retained in `D:/tmp/esl-33-follow-up/`.
This is local presentation/control evidence, not speech quality, screen-reader or print auditing,
hosted CI or production activation.

The approved continuous-document refinement on 7 October 2026 reused that same full lesson.
Before/after screenshots at 1280px and 390px cover every section with transcript/answers expanded.
Desktop reading blocks measured 621px and wider blocks 976px, all centered at x=640; phone blocks
measured 358px with 16px gutters, centered at x=195. Complete article text matched before/after.
The 400/600/700 hierarchy, pale-blue bordered cues, native disclosure/reveal controls, visible focus,
and audio error/Retry feedback remain. Focused local evidence and screenshot comparison slices
are retained in `D:/tmp/esl-33-reading-document/`. This delta changed only CSS and owning docs;
the earlier fixture-source and validation limitations still apply.

The maintainer-selected Product Design revision on 7 October 2026 supersedes the stripped
presentation above with restrained section markers, grammar left rules, shared comparison surfaces
and vocabulary separators. The full lesson remains unchanged. In-app browser captures at 1280px
and 390px were compared together with the selected reference after density/body-scale normalization;
the generated excerpt's shorter copy and larger type were explicitly accounted for. One excessive
section/subheading gap was fixed and recaptured. The project-root `design-qa.md` records the passing
visual gate, focused checks and limitations; screenshots and comparison images are retained in
`D:/tmp/esl-33-selected-design/`.

The four approved annotation refinements on 7 October 2026 retain that selected design while
replacing the visible Reveal text with the blurred-answer control, standardizing section 6,
enlarging the responsive hero and connecting the transcript spoiler frame. Full desktop/phone
captures and closed/hover/focus/revealed, long-answer, print-style and native transcript checks are
retained in `D:/tmp/esl-33-annotations/`. The existing `design-qa.md` preserves the earlier history
and records this bounded delta's passing comparison and 40-test evidence.

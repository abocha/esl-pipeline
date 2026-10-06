# @esl-pipeline/learner-handout

React learner components and the sole deterministic, unhydrated Node document renderer for native
AssignmentV1 preview/publication (renderer 3). **`html-publisher` remains the publication authority**
for renderer identity, HTML artifact hashing, object keys and S3 uploads. Vite is development-only.

## Ownership and component organization

The only runtime dependencies are React and React DOM; AssignmentV1 is imported as a type from
`contracts`. The package has no operator frontend, authentication, backend, orchestrator, storage,
upload, provider or TTS dependency. Keeping it separate from `batch-frontend` avoids tutor application
providers/routing. Keeping it separate from `html-publisher` allows presentation to evolve without
inheriting upload or publication-version responsibilities.

`LearnerHandout.tsx` composes the full eight-section surface, with local input/toolkit/practice/answer
components. `Pronunciation.tsx` handles the six existing modes. `primitives.tsx` owns escaped plain
text, fields, native disclosures, audio and safe source links/video. Domain text is never interpreted
as HTML or Markdown. Section 6 renders only new-shape `learnerRationale`. Legacy root `rationale`
is audience-ambiguous, so section 6 is omitted entirely. `teacherRationale` is retained in typed data
and never emitted into learner HTML, including attributes, scripts, comments or serialized data.
The other section IDs and labels remain stable.

Authored `metadata.instructionLanguage` sets the language of the static HTML document and shared
React article. English target text and fixed English presentation labels are marked separately;
comprehension questions (including answer-key copies), authored explanations and vocabulary meanings
use the support language. Comprehension answers and controlled-practice prompts/answers remain
explicitly English. This does not translate
the fixed UI labels. Missing metadata falls back to English in static presentation without inserting
fields into older assignments or changing canonical data.

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
The server inlines that CSS and `src/pronunciation-playback.js`, producing a standalone document with
no external style/script dependencies. Only trusted package assets use raw HTML insertion; all render
inputs pass through React escaping and URL admission.

`<details>` and audio controls remain native. The small vanilla script handles delegated item-clip
playback, pauses a previous item clip, and reports playback failure/retry status. Vite imports the
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

The first command emits 22 complete documents and the local tone into `out/learner-handout`, through
the compiled Node renderer. Each HTML can be opened directly with its sibling tone file. The optional
second command serves only those fixture files on `http://127.0.0.1:5175`; it uses no Vite and has no
production role. `/` opens `shadow_sentence-mixed.html`. Names are `<mode>-<audio>.html`, including
`none-available.html` and `shadow_sentence-unavailable.html`. `grammar.html` uses the separate compact
structured grammar fixture: present simple vs continuous, two form blocks, one paired routine vs
temporary contrast, distinct time-frame guidance and a missing-be trap.

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
colors are explicit hex presentation inputs, applied as heading accents; broader legacy theme and
feature options are retired. Preview missing-audio placeholders say "Audio track generating...";
publication unavailable states and disabled item controls remain explicit. Teacher’s Follow-up Plan
remains unchanged; teacher rationale is never copied into it. Static/Vite fixtures use the separate
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

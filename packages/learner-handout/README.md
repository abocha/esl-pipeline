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

The first command emits 21 complete documents and the local tone into `out/learner-handout`, through
the compiled Node renderer. Each HTML can be opened directly with its sibling tone file. The optional
second command serves only those fixture files on `http://127.0.0.1:5175`; it uses no Vite and has no
production role. `/` opens `shadow_sentence-mixed.html`. Names are `<mode>-<audio>.html`, including
`none-available.html` and `shadow_sentence-unavailable.html`.

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
new-shape rationale fixture; the ESL-20 legacy fixture and identity baseline remain untouched.

The package ships only `dist`, including CSS and playback JavaScript. React/React DOM are runtime
dependencies. Production builds traverse the workspace graph; orchestrator keeps publication
external to its bundle to preserve package-relative asset lookup.

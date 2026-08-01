# Contextual Speech Annotation Design

## Meta

- Audience: maintainers and AI agents changing study-text speech enhancement or Inworld synthesis.
- Authority Level: approved replacement design for the unreleased contextual schema-v2 branch.
- Last Verified Against: 2026-08-01 repo state at `13e509d5`.
- Owner: founder-maintainer + backend/orchestrator maintainers.
- Review Cadence: after implementation or materially different listening evidence.
- Status: `spec`.

## Goal

Improve learner-facing dialogue and monologue audio by letting `gpt-5.6-luna` insert optional,
context-aware bracket annotations into otherwise immutable authored speech. Luna sees the complete
assignment but returns only the ordered spoken segments. Validated annotations are rendered for
Inworld TTS-2; learner-visible assignment text never changes.

This design supersedes the scene/speaker/turn envelope architecture previously described in this
file. That implementation is unreleased and must be rewritten directly without migrations,
adapters, aliases, dual schemas, or compatibility shims.

## Product Contract

The enhancer receives the complete assignment as read-only context, including frontmatter, speaker
profiles, `role`, `persona`, `voice_direction`, and the complete dialogue or monologue. It returns:

```ts
{
  segments: [
    {
      id: 'segment-1',
      synthesisText:
        '<tts-annotation>Trying not to sound accusatory</tts-annotation>I thought we agreed on Friday.',
    },
  ];
}
```

`<tts-annotation>` and `</tts-annotation>` are reserved internal delimiters. Luna must not return
the full assignment document, speakers, analysis, evidence, scores, or acoustic controls.

Luna may insert:

- leading playable performance directions; and
- inline nonverbals such as sighs, laughs, breaths, or context-specific natural-language variants.

Luna must not:

- change, add, remove, or reorder any authored character;
- change punctuation, capitalization, whitespace, segment IDs, speakers, or segment order;
- annotate to satisfy a quota; or
- invent a reaction that materially changes the event, characterization, or intended meaning.

Unchanged `synthesisText` is valid. There is no cue-density target, annotation count, annotation
taxonomy, evidence structure, semantic validator, or quality score.

## Authored and Synthesis Text

- `text` remains the canonical learner-visible authored segment.
- `synthesisText` is the accepted internally annotated form and is used only for TTS.
- Annotations must never appear in learner text, subtitles, exports, or other canonical content.
- Accepted schema-v2 plans remain observable in the assignment manifest and optional debug logs.
- Cache identity includes the validated `synthesisText` and immutable enhancer version.

Released schema-v1 plans remain readable, renderable, and eligible for identity fallback. The new
schema-v2 shape replaces only the unreleased contextual schema-v2 shape.

## Mechanical Validation

Validation is atomic across the complete assignment. It must prove:

1. Candidate segment count, IDs, and order exactly match the prepared segments.
2. Every `synthesisText` has well-formed, non-nested reserved annotation spans.
3. Annotation bodies are non-empty, contain no reserved delimiter, square bracket, newline, or
   control character, and stay within the existing safe bounded cue-text grammar.
4. Annotation insertion points do not split a word or occur inside an authored punctuation
   sequence.
5. Removing only reserved annotation spans reconstructs each authored `text` byte-for-byte.

If authored text contains a reserved delimiter, enhancement is ineligible and uses identity
fallback without a provider call. If any candidate segment fails validation, discard the entire
candidate and synthesize every segment from untouched authored text. Do not keep valid-looking
segments from a rejected candidate.

Ordinary square brackets in authored text are never treated as inserted annotations. After the
candidate passes, deterministic rendering converts only reserved spans to Inworld square brackets,
adding synthesis-only separator spaces where necessary. Authored characters remain unchanged.

## Rendering and Modes

For a validated schema-v2 plan, Inworld receives the converted synthesis text directly. The
renderer must not compile scene, speaker, and turn layers or add pace, pause, emphasis, emotion,
intonation, nonverbal, or delivery instructions of its own.

- Stable voice assignment remains unchanged for every speaker.
- Inworld TTS-2 uses `BALANCED` delivery.
- Native pace is preserved by omitting `speakingRate`.
- Dialogue uses one complete multi-speaker context pass.
- Monologue uses the same complete-context annotation pass.
- Pronunciation practice bypasses enhancement entirely.

## Cleanup Boundary

Implementation begins by returning the subsystem to a coherent schema-v1/identity baseline. Remove
branch-local machinery used only by the discarded architecture:

- scene and speaker envelopes;
- acoustic-dimension taxonomies and scope precedence;
- basis references, quotations, control evidence, and learner-meaning flags;
- turn adjustments;
- planner-owned pace, pause, emphasis, structured nonverbals, and delivery mode;
- cue-density, stacking, and continuity metrics dedicated to those structures; and
- their tests, fixtures, documentation, configuration, and renderer support.

Preserve the released schema-v1 reading and fallback contracts, PR1/PR2 safety and reliability,
stable voice assignment, provider selection and Luna support, and historical PR3 evaluation
evidence. Do not remove free-form bracket annotation support while deleting the obsolete structured
nonverbal implementation. Do not revert unrelated post-`v10.4.0` work.

## Explicit Deferrals

- Inworld Realtime API integration.
- Monologue rechunking.
- Punctuation, capitalization, or authored-text rewriting.
- Provider-control tuning.
- Another evaluation harness or automated annotation scoring system.

## Product Acceptance

Use three representative existing assignments:

1. a restrained everyday dialogue;
2. a dialogue with a genuine emotional turn; and
3. a monologue with a changing thought process.

For each, inspect Luna's accepted annotations and manually compare unenhanced and enhanced Inworld
audio. Six clips are sufficient for one baseline/enhanced pair per assignment; repeat only a
candidate whose stochastic synthesis is genuinely ambiguous, with twelve clips as the ceiling.
This is product listening, not a new harness or a statistical claim.

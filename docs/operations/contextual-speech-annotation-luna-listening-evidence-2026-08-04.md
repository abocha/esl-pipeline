# Contextual Speech Annotation Luna Listening Evidence (2026-08-04)

## Meta

- Audience: founder-maintainer, backend/TTS maintainers, and reviewers.
- Authority Level: retained non-private live-trial evidence.
- Source Run: `20260804T174456954Z`.
- Status: automatic validation and blind human listening complete.

## Scope

This product-facing trial evaluated the released-candidate
`contextual-bracket-annotation-v1` contract, not the discarded contextual envelope architecture.
It used three representative real assignments held only in ignored local artifacts:

1. a restrained everyday dialogue;
2. a dialogue containing a genuine emotional turn; and
3. a monologue with a changing thought process.

Each assignment produced one unenhanced and one Luna-enhanced Inworld TTS-2 candidate. The six
clips used the same stable voice mapping, `BALANCED` delivery, native pace, and authored speech.
Candidate labels were randomized, and the listener recorded preferences before the key or accepted
plans were opened.

## Automatic Evidence

- Three live `gpt-5.6-luna` requests completed and reported 11,958 additional tokens for the run.
- All three returned exact model identity and passed schema-v2 structural validation.
- Removing only Luna's reserved annotation spans reconstructed every authored segment exactly,
  including IDs, ordering, speakers, whitespace, punctuation, and capitalization.
- Six non-empty Inworld TTS-2 MP3 candidates were produced.
- A monologue preparation defect discovered during the run was corrected: unlabeled later
  paragraphs now retain the active monologue speaker. The paired monologue audio was regenerated
  after the regression fix.
- Raw assignment text, audio, accepted plans, the blind key, and provider artifacts remain ignored
  under `tmp/contextual-speech-annotation-trial/` and are not repository evidence.

## Blind Listening Result

| Assignment                   | Enhanced label | Listener result                        |
| ---------------------------- | -------------- | -------------------------------------- |
| Restrained everyday dialogue | B              | Enhanced preferred; baseline also good |
| Genuine emotional turn       | A              | Enhanced clearly preferred             |
| Changing-thought monologue   | A              | No material preference; both good      |

Aggregate result: **two enhancement wins, zero baseline wins, and one tie**.

The strongest improvement occurred in the emotional-turn dialogue, where complete assignment
context allowed Luna to add directions matching regret, self-awareness, reassurance, and practical
support without changing learner-visible speech. The restrained dialogue showed a smaller positive
effect. The monologue remained acceptable in both forms, so the evidence does not imply that every
valid annotation produces a perceptible gain.

## Decision and Limits

This result supports `openai` plus exact `gpt-5.6-luna` as the selected contextual enhancer for
dialogue and monologue when speech-performance planning is enabled. Pronunciation practice remains
planner-free, and any invalid enhancement continues to fall back atomically to untouched authored
speech.

The run is bounded product evidence, not a statistical benchmark: it covers three assignments and
one listener. Luna annotated every segment in this sample despite the prompt allowing unchanged
output. Because blind listening found two improvements and no regression, this observation does not
justify adding cue-density rules, semantic scoring, or another evaluation framework.

# Student Memory Extraction Schema Spec

## Meta

- Audience: founder, maintainers, backend implementers, AI agents.
- Read Time: 10 minutes.
- Authority Level: semantic design reference; runtime response schemas are owned by backend source.
- Last Verified Against: 2026-05-12 repo state.
- Owner: founder-maintainer + backend maintainers.
- Review Cadence: monthly or after extraction-contract changes.
- Status: `reference`.

## Purpose

- Lock the exact semantic JSON shapes expected from LLM extraction for lesson memory, homework
  memory, and student-memory snapshots.
- Keep extraction-output contracts separate from backend-owned persistence metadata.
- Preserve semantic design decisions that informed implementation; executable schemas and
  validators now define the runtime contract.

## Relationship to Other Docs

This document preserves design decisions and rationale for structured extraction. Use the current
schemas, validators, prompts, and persistence DTOs in `packages/batch-backend/src` as the executable
contract; this document is not a field-by-field mirror of that code. Current lesson evidence
requires a `sourceId` selected from the request manifest and validated against the generation
envelope. The Zod parser's `legacy` default is compatibility handling; the fresh-generation JSON
schema requires the field. The older persistence note below that assigns source IDs to the backend
is historical. Use the package README for current lineage and read-eligibility rules.

- Use [`docs/reference/STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md`](STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md)
  for capability-tier and provider-policy rules.
- The archived [`phase 1 design`](../archive/plans/student-memory-system-upgrade/phase-1-requirements-contracts-and-schema-boundaries.md)
  records persisted-artifact design rationale; current contracts are owned by backend source.
- Use this doc for extraction design rationale; use backend schemas for the exact current JSON
  content objects returned by the model before persistence.

## Locked Decisions

1. Canonical LLM extraction returns semantic content objects only, not full persisted artifact rows.
2. All top-level keys in every extraction object are required.
3. Arrays default to `[]` when no reliable items are found.
4. `null` is used only for singleton nested fields where “unknown / not reliably derivable” is
   semantically different from “empty collection”.
5. Top-level objects and nested objects should be treated as closed (`additionalProperties: false`)
   where provider support allows.
6. Uncertainty belongs inside the schema through confidence, evidence, and omission-safe arrays, not
   through malformed output or missing top-level keys.
7. If a required singleton field cannot be generated reliably, the run should fail validation or be
   retried rather than accepting filler text.
8. Version 1 keeps schemas structurally strict but does not hard-cap every list at the schema level;
   compactness is primarily enforced by prompts and business validation.

## Backend-Enriched Fields

### Chronology and Read Semantics

`generatedAt` is the artifact extraction timestamp. It is never a lesson occurrence date.
Lesson-memory reads derive chronology through the verified confirmed source's assignment session,
constrained to the same student, and its linked `student_lessons` row. Only `completed` lessons
provide a reliable `starts_at`; scheduled, canceled, no-show, missing and foreign-student links leave
the occurrence date unknown. No extraction schema or public DTO field is added for this derivation.

Recent verified lesson reads and candidate source selection order by the completed occurrence
timestamp when present, otherwise extraction time. Extraction time, creation time and ID resolve
ties deterministically. Unlinked histories keep their extraction fallback order without rewriting
stored artifacts. Existing candidate API fields `sourceLessonId` and `sourceLessonStartedAt` carry
known lineage and occurrence time; an unknown occurrence remains null. New candidate provenance
records `sourceLessonGeneratedAt` and `sourceLessonChronology` as
`completed_lesson_started_at` or `memory_generated_at_fallback`. The Learning page labels the latter
as extraction time with an unknown lesson date. Older stored candidates are not retroactively dated.

### Stored Artifact Fields

These fields are persisted by the backend and are not requested from the model:

1. artifact ids
2. `studentId`
3. `schemaVersion`
4. `generatedAt`
5. `provider`
6. `model`
7. `status`
8. `sourceKind`
9. `sourceIds`
10. supersession state
11. prompt-package lineage ids and hashes
12. source-truth fields already known from the backend, including publish timestamps and publish
    targets

## Shared Enums

### Confidence

- `low`
- `medium`
- `high`

### Fact Authority

- `teacher_confirmed`
- `student_stated`
- `model_inferred`

### Input Type

- `generate`
- `authentic`

### Study Text Type

- `monologue`
- `dialogue`

### Pronunciation Mode

- `shadow_sentence`
- `intonation`
- `rhythm_chunking`
- `sentence_stress`
- `connected_speech`
- `minimal_pair`
- `other`

### Issue Type

- `grammar`
- `vocabulary`
- `pronunciation`
- `fluency`
- `communication`
- `review_loop`
- `other`

### Task Type

- `roadmap`
- `input`
- `grammar`
- `vocabulary`
- `controlled_practice`
- `comprehension`
- `pronunciation`
- `mission`
- `teacher_follow_up`
- `other`

### Target Kind

- `new`
- `review`
- `mixed`

### Follow-Up Cue Type

- `warm_up`
- `error_focus`
- `monitoring`
- `other`

### Priority

- `low`
- `medium`
- `high`

## Shared Evidence Objects

### `FactEvidence`

```json
{
  "sourceId": "request-manifest source id",
  "quote": "string",
  "speakerRole": "student | teacher | null",
  "evidenceNote": "string | null",
  "transcriptSpan": "string | null"
}
```

Rules:

1. `quote` is required when a fact-evidence object exists.
2. `speakerRole` may be `null` when the quote is reliable but speaker attribution is not.
3. `evidenceNote` and `transcriptSpan` are optional singleton context fields represented as nullable
   strings.

### `MistakeEvidence`

```json
{
  "sourceId": "request-manifest source id",
  "observedForm": "string",
  "suggestedTarget": "string | null",
  "evidenceQuote": "string | null",
  "evidenceNote": "string | null",
  "confidenceNote": "string | null"
}
```

Rules:

1. `observedForm` is required.
2. `suggestedTarget` is nullable because some mistake patterns are classification-first rather than
   correction-first.
3. Evidence should only be present when the signal is strong enough to survive transcript noise.

### `PronunciationEvidence`

```json
{
  "sourceId": "request-manifest source id",
  "observedIssue": "string",
  "focusWords": ["string"],
  "evidenceQuote": "string | null",
  "evidenceNote": "string | null",
  "confidenceNote": "string | null"
}
```

Rules:

1. `focusWords` defaults to `[]`.
2. Pronunciation evidence is optional and should be omitted at the item level if support is too
   noisy.

## Shared Semantic Objects

### `StudentFactContent`

```json
{
  "fact": "string",
  "category": "string",
  "authority": "teacher_confirmed | student_stated | model_inferred",
  "confidence": "low | medium | high",
  "evidence": [
    {
      "sourceId": "request-manifest source id",
      "quote": "string",
      "speakerRole": "student | teacher | null",
      "evidenceNote": "string | null",
      "transcriptSpan": "string | null"
    }
  ],
  "reviewNeeded": false
}
```

Rules:

1. `evidence` defaults to `[]`.
2. Each evidence item identifies its request-manifest source; backend validates that ID against
   the generation envelope before persistence.

### `NamedNote`

```json
{
  "name": "string",
  "note": "string"
}
```

### `LabeledNote`

```json
{
  "label": "string",
  "note": "string"
}
```

## Canonical Extraction Objects

### `LessonMemoryContent`

```json
{
  "lessonSummary": "string",
  "topicsDiscussed": [
    {
      "topic": "string",
      "note": "string"
    }
  ],
  "mistakePatterns": [
    {
      "label": "string",
      "explanation": "string",
      "reviewRecommended": true,
      "confidence": "low | medium | high",
      "evidence": [
        {
          "observedForm": "string",
          "suggestedTarget": "string | null",
          "evidenceQuote": "string | null",
          "evidenceNote": "string | null",
          "confidenceNote": "string | null"
        }
      ]
    }
  ],
  "grammarReviewed": [{ "name": "string", "note": "string" }],
  "grammarWatchlist": [{ "name": "string", "note": "string" }],
  "vocabularyFocus": [
    {
      "text": "string",
      "note": "string"
    }
  ],
  "pronunciationFocus": [
    {
      "label": "string",
      "note": "string",
      "confidence": "low | medium | high",
      "evidence": [
        {
          "observedIssue": "string",
          "focusWords": ["string"],
          "evidenceQuote": "string | null",
          "evidenceNote": "string | null",
          "confidenceNote": "string | null"
        }
      ]
    }
  ],
  "studentFacts": [
    {
      "fact": "string",
      "category": "string",
      "authority": "teacher_confirmed | student_stated | model_inferred",
      "confidence": "low | medium | high",
      "evidence": [
        {
          "quote": "string",
          "speakerRole": "student | teacher | null",
          "evidenceNote": "string | null",
          "transcriptSpan": "string | null"
        }
      ],
      "reviewNeeded": false
    }
  ],
  "progressSignals": [{ "label": "string", "note": "string" }],
  "followUpRecommendations": [{ "label": "string", "note": "string" }]
}
```

Rules:

1. Every top-level key is required.
2. All arrays default to `[]`.
3. `mistakePatterns[].evidence` and `pronunciationFocus[].evidence` default to `[]`.
4. `lessonSummary` is required and should be concise, specific, and human-readable.

### `HomeworkMemoryContent`

```json
{
  "homeworkSummary": "string",
  "topic": "string",
  "grammarTargets": [
    {
      "name": "string",
      "note": "string",
      "targetKind": "new | review | mixed"
    }
  ],
  "vocabularyTargets": [
    {
      "text": "string",
      "note": "string",
      "targetKind": "new | review | mixed"
    }
  ],
  "reviewTargets": [{ "label": "string", "note": "string" }],
  "taskList": [
    {
      "section": "string",
      "task": "string",
      "taskType": "roadmap | input | grammar | vocabulary | controlled_practice | comprehension | pronunciation | mission | teacher_follow_up | other",
      "review": false
    }
  ],
  "pronunciationFocus": [
    {
      "mode": "shadow_sentence | intonation | rhythm_chunking | sentence_stress | connected_speech | minimal_pair | other",
      "target": "string",
      "action": "string"
    }
  ],
  "studyTextType": "monologue | dialogue",
  "inputType": "generate | authentic",
  "communicativeOutcome": "string",
  "teacherFollowUpCues": [
    {
      "cueType": "warm_up | error_focus | monitoring | other",
      "note": "string"
    }
  ]
}
```

Rules:

1. Backend, not the model, owns `publishedAt` and `publishTargets`.
2. `taskList` should capture pedagogic task shape, not decorative formatting.
3. `teacherFollowUpCues` defaults to `[]`, though version 1 prompts should usually produce at least
   one useful cue.
4. `pronunciationFocus` defaults to `[]` if the assignment has no reliable pronunciation target.

### `StudentMemorySnapshotContent`

```json
{
  "stableStrengths": [{ "label": "string", "note": "string" }],
  "recurringIssues": [
    {
      "label": "string",
      "issueType": "grammar | vocabulary | pronunciation | fluency | communication | review_loop | other",
      "note": "string",
      "confidence": "low | medium | high"
    }
  ],
  "activeReviewBacklog": [{ "label": "string", "note": "string" }],
  "recentProgress": [{ "label": "string", "note": "string" }],
  "personalFacts": [
    {
      "fact": "string",
      "category": "string",
      "authority": "teacher_confirmed | student_stated | model_inferred",
      "confidence": "low | medium | high",
      "evidence": [
        {
          "quote": "string",
          "speakerRole": "student | teacher | null",
          "evidenceNote": "string | null",
          "transcriptSpan": "string | null"
        }
      ],
      "reviewNeeded": false
    }
  ],
  "recommendedAssignmentDirections": [
    {
      "direction": "string",
      "rationale": "string"
    }
  ],
  "unresolvedIssues": [
    {
      "label": "string",
      "issueType": "grammar | vocabulary | pronunciation | fluency | communication | review_loop | other",
      "note": "string",
      "priority": "low | medium | high"
    }
  ],
  "snapshotSummary": "string"
}
```

Rules:

1. `unresolvedIssues` is required and defaults to `[]`.
2. `snapshotSummary` is required and compact.
3. `personalFacts` uses the same extraction shape as lesson/homework fact content; backend attaches
   source artifact ids during persistence.

## Nullability and Empty-Collection Rules

Version 1 defaults:

1. top-level arrays use `[]`
2. top-level singleton fields are required and non-null
3. nullable fields are used only for nested singleton context where unknown is legitimate
4. do not substitute placeholder strings such as `unknown`, `n/a`, or `not available`

## Output Hygiene Rules

The model should be instructed to:

1. return JSON only
2. omit markdown fences
3. keep strings concise and information-dense
4. avoid duplicating the same idea across multiple arrays
5. prefer omission of weak evidence over low-confidence overclaiming

## Validation Rules

The backend should reject or retry outputs when:

1. required top-level fields are empty placeholders
2. enums contain out-of-contract values
3. evidence objects are malformed
4. item arrays are stuffed with duplicates or obvious noise
5. transcript corruption is represented as learner error without confidence-aware handling

## Change Control

When extraction shape changes:

The original change sequence below is retained as historical design guidance, not a current
implementation procedure. For changes, follow the current repository workflow and update executable
backend schemas, validators, persistence contracts, prompts, and focused evidence together.

## Related

- [`docs/reference/STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md`](STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md)
- [Archived phase 1 design](../archive/plans/student-memory-system-upgrade/phase-1-requirements-contracts-and-schema-boundaries.md)
- [Archived phase 2 design](../archive/plans/student-memory-system-upgrade/phase-2-lesson-memory-pipeline.md)
- [Archived phase 3 design](../archive/plans/student-memory-system-upgrade/phase-3-homework-memory-pipeline.md)
- [Archived phase 4 design](../archive/plans/student-memory-system-upgrade/phase-4-student-rollup-and-retrieval-packaging.md)

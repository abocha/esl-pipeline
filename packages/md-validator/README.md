# @esl-pipeline/md-validator

Markdown validator for ESL pipeline assignments.

## What it does

- Validates frontmatter and section structure.
- Enforces runtime-safe contracts (for parser/publisher stages).
- Emits backward-compatible `errors` / `warnings`.
- Emits additive structured `issues` and resolved `ruleset` metadata.

## Architecture

The validator now uses a ruleset engine layout:

- `src/validator.ts`: compatibility facade (`validateMarkdown`)
- `src/core/*`: input normalization + issue/result shaping
- `src/rules/*`: execution contracts + base rule group placeholders
- `src/rulesets/registry.ts`: ruleset resolution (`learningPresetId` + version)
- `src/rulesets/general-english/v1.ts`: compatibility implementation for persisted v1 jobs
- `src/rulesets/general-english/v2.ts`: typed strict-diagnostic classification over the v1
  structural analysis

Current effective ruleset:

- `general-english@v2` (default fallback)
- `general-english@v1` remains available when explicitly requested for persisted-job compatibility.

## API

```ts
import { validateMarkdown } from '@esl-pipeline/md-validator';

const result = await validateMarkdown({
  markdown: '# ...',
  strict: true,
  learningPresetId: 'general-english', // optional
  learningPresetVersion: 'v2', // optional; omit for the current default
});
```

Input sources:

- `{ path: string }`
- `{ markdown: string }`
- `{ context: ParsedMarkdownContext }`

## Ruleset resolution

Resolution order:

1. Known `learningPresetId` + known version -> that exact ruleset.
2. Known `learningPresetId` without a version -> `general-english@v2`.
3. Unknown preset or version -> `general-english@v2` + warning issue.
4. No preset context -> `general-english@v2`.

## Response model

Backward-compatible fields remain:

- `ok`
- `errors: string[]`
- `warnings: string[]`
- `meta?`
- `voiceDiagnostics?`

Additive fields:

- `issues?: MarkdownValidationIssue[]`
- `ruleset?: MarkdownValidationRuleSetInfo`

`MarkdownValidationIssue`:

- `code`, `ruleId`, `severity`, `message`, `line?`, `category`, `blockingInStrict`

## Strict behavior

- `general-english@v2` obtains strict escalation, stable issue code, category, and
  `blockingInStrict` from one ordered typed policy table.
- In v2, `error` issues always block and warnings block exactly when their policy sets
  `blockingInStrict: true`; unmatched diagnostics receive the blocking stable code
  `general_english_v2.unclassified_diagnostic`.
- `:::audio` and `:::video` remain optional. If emitted, each must include a usable URL; a bare
  marker blocks strict v2 validation. Omitted media directives remain valid.
- `general-english@v1` retains its legacy strict behavior for explicitly persisted v1 jobs.
- Current `general-english@v2` assignments require the eight-H2 homework order. Comprehension Check
  must be an unlettered H3 after the study-text block under Input Material; Controlled Practice and
  Pronunciation Micro-Focus remain `A` and `B` under the fourth H2. The removed Homework Roadmap is
  not part of the v2 structure.

## Tests

```bash
pnpm --filter @esl-pipeline/md-validator test
```

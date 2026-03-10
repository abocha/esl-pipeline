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
- `src/rulesets/registry.ts`: ruleset resolution (`learningPresetId`)
- `src/rulesets/general-english/v1.ts`: current implemented ruleset logic

Current effective ruleset:

- `general-english@v1` (default fallback)

## API

```ts
import { validateMarkdown } from '@esl-pipeline/md-validator';

const result = await validateMarkdown({
  markdown: '# ...',
  strict: true,
  learningPresetId: 'general-english', // optional
  learningPresetVersion: 'v1', // optional
});
```

Input sources:

- `{ path: string }`
- `{ markdown: string }`
- `{ context: ParsedMarkdownContext }`

## Ruleset resolution

Resolution order:

1. Known `learningPresetId` -> mapped ruleset.
2. Unknown `learningPresetId` -> fallback to `general-english@v1` + warning issue.
3. No preset context -> `general-english@v1`.

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

- `error` issues always block.
- Contract warnings block when `strict: true`.
- Advisory warnings never block.

## Tests

```bash
pnpm --filter @esl-pipeline/md-validator test
```

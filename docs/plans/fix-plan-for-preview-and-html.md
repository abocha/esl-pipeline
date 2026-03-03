# Fix Plan: Preview/Published HTML Behavior + Pronunciation Placement + Inline Code Semantics

## Summary

We will fix four linked regressions with one coordinated renderer/placement update:

1. Embedded behavior script is currently syntactically broken in generated HTML (sectionElements.map(...).join('\n')
 is emitted as an actual newline inside a JS string), which prevents script execution and explains both dark-mode
 toggle failure and missing pronunciation play buttons.
2. Theme logic is brittle when storage/media-query APIs are unavailable, which can still break script execution in
 some environments even after syntax is fixed.
3. Pronunciation audio insertion anchor logic is still too narrow for real markdown variants, so generated audio can
 appear above the intended shadow-sentence location.
4. Current preprocessing strips single-backtick spans globally, which breaks code-pill semantics and causes inline
 code content to lose <code> rendering.

## Current-State Findings (Grounded)

1. Generated HTML at tmp/html-output.htm shows pronunciation audio above shadow sentence (tmp/html-output.htm:834
 before :835).
2. Generated script in tmp/html-output.htm contains broken JS string join (tmp/html-output.htm:1062-1063),
 confirming parse failure.
3. Because the script fails, both theme toggle and pronunciation button injection do not run.
4. Current renderer preprocess path performs global single-backtick unwrapping (packages/html-publisher/src/
 rendering.ts, normalizeInlineBacktickSnippets and helpers), conflicting with desired code-snippet behavior.
5. User-confirmed target behavior is:
  - Single-backtick snippets should remain code-pill snippets and allow rich inner formatting.
  - Pronunciation audio should be anchored immediately after shadow sentence.

## Implementation Plan

### 1) Restore script execution and harden behavior runtime

1. Update buildBehaviorScript() in packages/html-publisher/src/rendering.ts to emit escaped newline literals for JS
 strings ('\\n' in generated script), eliminating the syntax error.
2. Add safe storage helpers in the generated script (safeGetThemePreference, safeSetThemePreference) with try/catch
 around localStorage access.
3. Add MediaQuery fallback handling (addEventListener when available, otherwise addListener) to avoid runtime
 failure on older browser APIs.
4. Isolate theme logic from pronunciation logic with local guards so theme failures do not block pronunciation
 control injection.
5. Add defensive top-level compartmentalization in script sections so one feature failure does not stop all
 features.

### 2) Make pronunciation audio placement deterministic and resilient

1. Replace narrow shadow-sentence matching with a canonical matcher used in both:
  - packages/batch-backend/src/transport/extended-routes.ts
  - packages/orchestrator/src/index.ts
2. Canonical matcher behavior:
  - Recognize Shadow sentence lines across markdown variants: bold/non-bold, bulleted/non-bulleted, code-wrapped/
	non-code-wrapped, with or without immediate value after colon.
  - If label has no inline value, treat the next non-empty line as continuation and anchor after that continuation
	line.
3. Normalize insertion behavior:
  - Remove all existing generated pronunciation link variants before reinserting.
  - Reinsert at canonical anchor (immediately after shadow sentence block).
  - Apply same logic for placeholder (:::audio) and concrete URL link.
4. Keep heading fallback only when no shadow sentence anchor exists.

### 3) Rework inline code behavior to preserve code pills with rich inner formatting

1. Remove global single-backtick stripping pipeline:
  - Delete/retire normalizeInlineBacktickSnippets, removeSingleInlineBackticks, and related helpers from packages/
	html-publisher/src/rendering.ts.
2. Implement renderer-level inline code behavior in createRenderer():
  - Override code_inline rule.
  - For single-backtick spans (token.markup.length === 1): render as <code> while parsing inner markdown inline
	(bold/italic/etc.) so rich formatting appears inside code pill.
  - For multi-backtick spans (token.markup.length > 1): preserve standard escaped code behavior exactly.
3. Adjust pronunciation-specific normalization:
  - Keep targeted cleanup for malformed Mode/Shadow wrapper lines.
  - Stop blanket stripping of backticks from numbered pronunciation entries so inline code semantics remain
	consistent.

### 4) Keep docs aligned with actual behavior

1. Update packages/html-publisher/README.md preprocessing notes to reflect final code-span semantics (single-
 backtick rich-in-code, multi-backtick preserved, fenced blocks untouched).
2. Update packages/html-publisher/CHANGELOG.md patch notes to include:
  - script parse/runtime hardening,
  - pronunciation anchor fix,
  - final inline code semantics.

## Public APIs / Interfaces / Types

1. No function signatures or exported TypeScript interfaces change.
2. Behavioral output contract changes:
  - Inline single-backtick spans now render as <code> with rich inner formatting.
  - Pronunciation generated audio insertion location is stabilized to post-shadow-sentence anchor.
  - Client-side behavior script is valid and resilient, restoring theme toggle and pronunciation play control
	injection.

## Test Plan

1. Add regression test that extracts embedded script and asserts it is syntactically parseable (new
2. Add regression test that confirms single-backtick rich inline content renders as <code> containing <strong>/<em>
 children.
3. Keep/extend test that multi-backtick spans preserve literal backticks inside code output.
4. Add test for pronunciation section variant where Shadow sentence: label and sentence are on separate lines,
 verifying anchor logic downstream expectations via rendered ordering markers.

### Backend preview integration tests (packages/batch-backend/tests/transport.http-server.integration.test.ts)

1. Add case for shadow sentence split over two lines; verify pronunciation placeholder/link appears after shadow
 sentence content.
2. Add case where generated pronunciation link exists in wrong position; verify preview output repositions it below
 shadow sentence.
3. Keep existing “no visible generated marker” assertions.

### Orchestrator behavior coverage

1. Add/extend tests around insertGeneratedAudioLinks to verify canonical post-shadow placement for:
  - inline sentence,
  - multiline sentence,
  - code-wrapped/bulleted variants,
  - pre-existing generated link relocation.

### Validation commands

1. pnpm --filter @esl-pipeline/html-publisher test
2. pnpm --filter @esl-pipeline/batch-backend exec vitest run --config ../../vitest.config.ts ../../packages/batch-
 backend/tests/transport.http-server.integration.test.ts --reporter=dot --maxWorkers=1
3. pnpm --filter @esl-pipeline/orchestrator test (targeted file if available) or typecheck if no unit coverage
 exists for helper paths.

## Rollout and Risk Controls

1. No migrations or data-shape changes required.
2. Main risk is unintended rendering changes for legacy inline code content; mitigated by:
  - limiting rich parsing to single-backtick spans only,
  - preserving multi-backtick and fenced code semantics,
  - explicit regression tests for both behaviors.
3. Manual verification pass after tests:
  - preview iframe theme toggle,
  - published HTML theme toggle,
  - pronunciation play buttons visible/clickable,
  - pronunciation audio block placement directly after shadow sentence.

## Assumptions and Defaults (Locked)

1. Single-backtick behavior: Code + Rich Inner (keep code pill, allow markdown formatting inside).
2. Pronunciation audio anchor: Immediately after shadow sentence (before drill list).
3. No broad redesign of styling/UX beyond bug-fix scope in this pass.
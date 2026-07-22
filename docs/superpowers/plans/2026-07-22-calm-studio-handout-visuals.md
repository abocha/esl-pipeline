# Calm Studio Handout Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align newly rendered student handouts with Calm Studio through restrained colors, flat surfaces, quieter geometry, and finished-product interaction details.

**Architecture:** Keep the public theme-token API and generated markup structure stable. Change the default token values and embedded stylesheet in `css.ts`, make one table-of-contents label refinement in `postprocess.ts`, and protect the output contract in the existing rendering suite.

**Tech Stack:** TypeScript, Vitest, embedded CSS, Chrome visual inspection

## Global Constraints

- Preserve the serif handout title and frontmatter emoji.
- Preserve all lesson-section and subsection emoji.
- Preserve `RenderOptions.theme` override behavior and generated HTML structure.
- Keep the editorial-rail fade as the only structural gradient.
- Use 8-12px radii for handout panels and restrained or absent shadows.
- Do not alter markdown parsing, lesson content, or publishing contracts. Behavior changes are limited
  to making the existing disclosure animation deterministic.

---

### Task 1: Lock the Calm Studio visual contract

**Files:**

- Modify: `packages/html-publisher/tests/rendering.core-media-layout.test.ts`
- Modify: `packages/html-publisher/src/rendering/css.ts`

**Interfaces:**

- Consumes: `renderToHtml(markdown: string, title: string, options?: RenderOptions): Promise<string>`
- Produces: generated HTML containing the revised default theme and embedded CSS

- [ ] **Step 1: Write failing tests**

Add assertions that the generated HTML contains the Calm Studio-derived light and dark token values,
uses a flat body and hero treatment, and has no decorative gradient in tags, callouts, contents, or
grammar-matrix panels. Assert that `.page::before` still contains one `linear-gradient`.

- [ ] **Step 2: Verify the tests fail for the current warm theme**

Run: `pnpm --filter @esl-pipeline/html-publisher exec vitest run tests/rendering.core-media-layout.test.ts`

Expected: FAIL on the new palette and flat-surface assertions.

- [ ] **Step 3: Implement the minimal CSS and token changes**

Update `DEFAULT_THEME`, the dark-mode token blocks, fixed interaction colors, and decorative surface
rules in `css.ts`. Keep markup selectors, theme option fields, and the editorial-rail fade stable.

- [ ] **Step 4: Verify the focused tests pass**

Run: `pnpm --filter @esl-pipeline/html-publisher exec vitest run tests/rendering.core-media-layout.test.ts`

Expected: PASS.

### Task 2: Validate renderer behavior and visual output

**Files:**

- Verify: `packages/html-publisher/src/rendering/css.ts`
- Verify: `packages/html-publisher/tests/rendering.core-media-layout.test.ts`

**Interfaces:**

- Consumes: the generated single-file handout HTML
- Produces: validation evidence and Chrome screenshots for representative states

- [ ] **Step 1: Run focused package validation**

Run:

```text
pnpm --silent --filter @esl-pipeline/html-publisher run test:unit:agent
pnpm --filter @esl-pipeline/html-publisher run typecheck
```

Expected: all package tests and typecheck pass.

- [ ] **Step 2: Run the affected repository gate**

Run: `pnpm --silent run check:fast:agent`

Expected: PASS, or inspect the emitted failure artifact before any rerun.

- [ ] **Step 3: Inspect representative Chrome states**

Render a representative handout and inspect desktop light, desktop dark, narrow, and print media.
Verify that the palette is cool-neutral, blue is restrained, decorative gradients are absent, text
remains readable, and no content overflows.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check` and `git diff -- packages/html-publisher docs/superpowers`.

Expected: no whitespace errors and only the approved visual/test/design-plan scope.

### Task 3: Apply the finished-product polish pass

**Files:**

- Modify: `packages/html-publisher/src/rendering/css.ts`
- Modify: `packages/html-publisher/src/rendering/postprocess.ts`
- Modify: `packages/html-publisher/tests/rendering.core-media-layout.test.ts`

- [x] **Step 1: Add failing contracts for editorial headings, flat grammar comparison, consistent disclosures, balanced rail geometry, touch targets, mobile metadata, and reduced motion**
- [x] **Step 2: Implement the minimal CSS and table-of-contents label changes while preserving every emoji**
- [x] **Step 3: Verify the focused rendering tests and inspect desktop and mobile output in Chrome**
- [x] **Step 4: Run final package and affected-repository validation**

### Task 4: Compact and stabilize “Jump to section”

**Files:**

- Modify: `packages/html-publisher/src/rendering/css.ts`
- Modify: `packages/html-publisher/src/rendering/behavior-ui.ts`
- Modify: `packages/html-publisher/tests/rendering.core-media-layout.test.ts`

- [x] **Step 1: Reproduce the intermittent disclosure transition and record the native-details timing race**
- [x] **Step 2: Add failing contracts for compact desktop links, nested-title indentation, mobile touch targets, and deferred closing**
- [x] **Step 3: Implement hierarchical TOC spacing and a transition-complete disclosure close**
- [x] **Step 4: Regenerate the lesson fixture, inspect desktop/mobile motion in Chrome, and rerun final validation**

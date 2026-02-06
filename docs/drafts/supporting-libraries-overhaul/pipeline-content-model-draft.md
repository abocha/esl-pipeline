# Pipeline Content Model Draft (PMD)

This draft defines a stable content model for ESL pipeline inputs, independent
of any specific backend (Notion, AppFlowy, self-hosted). The idea is to parse a
single authoring format into a normalized AST, then adapt it to each target.

## Goals

- Keep authoring simple and LLM-friendly (Markdown + YAML frontmatter).
- Decouple authoring syntax from backend-specific representations.
- Enable a rich frontend preview by rendering the AST.
- Preserve backward compatibility with legacy fenced inputs.

## Canonical Authoring Format

Preferred input is plain Markdown with YAML frontmatter at byte 0.
Custom blocks use container directives (remark-directive style).

Example (frontmatter-first, no fences):

```markdown
---
title: 'Homework Assignment: ...'
student: 'Tolik'
level: 'A1+'
topic: 'Grammar, Speaking'
input_type: 'generate'
icon: 'target'
speaker_labels: [Teacher]
speaker_profiles:
  - id: Teacher
    role: narrator
---

## 1. Mission Briefing

:::callout target
Goal text...
:::
```

Legacy inputs may wrap the entire assignment in a single fenced code block;
this path remains supported but deprecated (warn immediately).

## Directive Vocabulary (PMD v1)

Block-level directives (containers):

- `:::study-text <label?>`
- `:::toggle <title>`
- `:::callout <icon?>`
- `:::column-list`
  - `:::column`
- `:::synced-block`

Leaf directives:

- `:::toc`
- `:::audio <url>`
- `:::video <url>`

Notes:

- Directives can be nested where it makes sense (e.g., toggle contains headings).
- Parsing must be nesting-aware (no regex-only parsing).
- `:::toggle-h2` / `:::toggle-h3` remain accepted as legacy aliases.

## Pipeline Content Model (AST)

Top-level:

- `Document`
  - `frontmatter` (parsed YAML)
  - `body` (array of `Block`)

Blocks (subset):

- `Section` (h2/h3 headings)
- `Paragraph`
- `List` / `ListItem`
- `Table`
- `Quote`
- `CodeBlock`
- `DirectiveBlock`
  - `type`: `study_text`, `toggle`, `callout`, `columns`, `synced_block`
  - `attrs`: e.g. `{ level: 2, title: "Answer Key", icon: "target" }`
  - `children`: array of `Block`
- `DirectiveLeaf`
  - `type`: `toc`, `audio`, `video`
  - `attrs`: e.g. `{ url: "..." }`

Directive mapping examples:

- `:::callout target` -> `DirectiveBlock(type="callout", attrs={ icon: "target" })`
- `:::toggle Answer Key` -> `DirectiveBlock(type="toggle", attrs={ title: "Answer Key" })`
- `:::column-list` -> `DirectiveBlock(type="columns")` with child `DirectiveBlock(type="column")`

## Parser Responsibilities

1. Parse YAML frontmatter (must start at byte 0).
2. Parse Markdown into an AST (remark-parse + remark-frontmatter + remark-directive).
3. Convert remark AST into PMD AST.
4. Apply validation rules using the PMD AST (required sections, required directives).
5. Emit warnings for legacy fenced input.

## Adapter Responsibilities

Notion adapter:

- Map PMD blocks to Notion blocks (toggle, callout, columns, headings, tables).
- Enforce Notion API limits (block chunking, max blocks per request).
- Apply rendering preferences (see "Notion Rendering Preferences" below).
- Centralize Notion client creation and retry/backoff policy to avoid drift.

Frontend preview:

- Render PMD blocks into React components.
- Provide visual styling for `callout`, `toggle`, `columns`, and `study_text`.

Future adapters (AppFlowy/self-hosted):

- Implement a PMD -> target mapping layer only.
- No changes to PMD authoring format required.

## Validation Rules (High-Level)

- Require frontmatter at byte 0 (no BOM/whitespace).
- Require exactly one `study_text` directive.
- Require Answer Key toggle and Teacher Plan toggle.
- Require standard section headings (H2/H3 sequence).
- Ensure directives are properly closed and nested.
- Avoid `console` logging in core libraries; surface warnings via structured results/loggers.

## Notion Rendering Preferences

Answer Key + Teacher Follow-up Plan:

- Render as plain toggle blocks (not heading toggles).
- Do not apply heading colorization to these toggles.
- Match titles case-insensitively and accept any apostrophe variant in "Teacher's".

Pronunciation callout:

- Treat the first `Target: ...` line as the callout's title line (not a list item).
- Render `**Focus:**`, `**Action:**`, and `**Deliverable:**` as plain paragraphs.
- Preserve ordered lists for example lines.

## Deprecation

- Legacy fenced format is allowed but deprecated immediately.
- Validators should emit a warning when legacy input is detected.

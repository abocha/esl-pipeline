# Markdown Input Format Draft (Frontmatter-First)

This draft captures the agreed direction for ESL pipeline markdown input and
validator behavior. It is a working note; we will iterate before implementation.

## Goals

- Standardize on plain Markdown files that start with YAML frontmatter.
- Keep backward compatibility for legacy "single fenced code block" inputs.
- Deprecate the legacy path immediately with warnings.

## Canonical Format (Preferred)

The input file is standard Markdown. It MUST start with YAML frontmatter at byte 0.

Rules:

- The very first bytes MUST be `---` (no leading BOM, whitespace, or comments).
- YAML frontmatter ends at the next `---` line.
- Markdown content follows.
- No surrounding code fences.

Example (preferred):

```markdown
---
title: 'Homework Assignment: Pets, Abilities & Desires'
student: 'Tolik'
level: 'A1+'
topic: 'Grammar (Can vs Want), Pets'
input_type: 'generate'
icon: 🐕
speaker_labels: [Teacher]
speaker_profiles:
  - id: Teacher
    display_name: Teacher
    role: narrator
    gender: male
    age: adult
    accent: american
    style: storytelling
---

## 1. 🎯 This Week's Mission Briefing

...
```

## Legacy Format (Deprecated)

Single fenced code block that contains the entire assignment, with frontmatter
at the top inside the fence.

Rules:

- File may start with ``` (optional language tag allowed).
- The fenced block MUST be the only non-whitespace content in the file.
- Inside the block, the first bytes MUST be `---`.
- Any extra content outside the fence causes validation failure.

Example (legacy):

```markdown

```

---

title: "Homework Assignment: Pets, Abilities & Desires"
...

---

## 1. 🎯 This Week's Mission Briefing

...

```

```

## Validator Behavior (Planned)

1. If the file starts with `---` at byte 0:
   - Parse as canonical format.
   - If any leading BOM or whitespace exists before `---`, fail validation.

2. Else if the file starts with ``` (legacy path):
   - Extract the first fenced block.
   - Ensure there is no non-whitespace outside the block.
   - Validate that the block begins with `---`.
   - Emit a warning: "Legacy fenced markdown is deprecated; remove the code fence."

3. Otherwise:
   - Fail: "Expected YAML frontmatter at file start or a legacy fenced block."

## Prompt Guidance (Planned)

- Ask the LLM to output plain Markdown only, starting with YAML frontmatter.
- If the UI expects a code block for copy convenience, the user should copy
  the contents without the backticks. The output itself should not include fences.

Suggested wording:

- "Output only markdown. Do not wrap in ```."
- "Begin the output with YAML frontmatter (`---`)."

## Deprecation Policy

- Legacy fenced inputs are supported but deprecated immediately.
- Validators should emit warnings on legacy usage.
- We can set a sunset date/version later if desired.

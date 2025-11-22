# Notion Importer: Advanced Features Reference Guide

**Last Updated:** 2025-11-22  
**Version:** 2.0

---

## Table of Contents

1. [Overview](#overview)
2. [Frontmatter Fields](#frontmatter-fields)
3. [Custom Directives](#custom-directives)
4. [Topic Normalization](#topic-normalization)
5. [Complete Example](#complete-example)
6. [Migration Guide](#migration-guide)
7. [Troubleshooting](#troubleshooting)

---

## Overview

The Notion importer now supports advanced Notion features through enhanced frontmatter and custom markdown directives. All features are **optional** and **backward compatible** with existing markdown files.

### What's New

- **Page customization**: Set icons and cover images
- **Rich layouts**: Callouts, multi-column layouts, table of contents
- **Media embeds**: Audio and video from external URLs
- **Advanced headings**: Toggleable headings at multiple levels
- **Reusable content**: Synced blocks
- **Custom properties**: Attach existing database properties (fail-fast if missing)
- **Topic handling**: Auto-normalization of comma-separated topics and type detection from DB schema

---

## Frontmatter Fields

### Basic Fields (Existing)

```yaml
---
title: 'Homework Assignment: Conditionals Type 2'
student: Anna
level: B1
topic: Second Conditional
input_type: generate
speaker_labels: [Alex, Mara]
---
```

### New Fields

#### `icon` (Optional)

Set a page icon (emoji only).

```yaml
icon: 🎯
```

**Notes:**

- Must be a **single emoji character**
- Validated to ensure it's a valid emoji
- Appears in Notion page list and at top of page

**Examples:**

```yaml
icon: 📚  # For reading assignments
icon: 🎧  # For listening exercises
icon: 💬  # For conversation practice
```

---

#### `cover` (Optional)

Set a page cover image from a URL.

```yaml
cover: https://example.com/images/cover.jpg
```

**Notes:**

- Must be a **valid URL** (http:// or https://)
- Image should be hosted externally
- Notion will display this as the page cover

---

#### `properties` (Optional)

Add existing database properties to the Notion page.

```yaml
properties:
  Status: 'In Progress' # requires a Status/Select/Status prop in the DB
  Audio: 'https://s3.amazonaws.com/bucket/file.mp3'
  Notes: 'This lesson covers conditionals'
```

**Property Rules:**

- Property names must already exist in the target database (unknown properties fail fast).
- URLs (starts with `http`) → **url** property
- Everything else → **rich_text** property
- Empty values are automatically skipped

**Important Notes:**

- The `Audio` property is typically added by the `notion-add-audio` package post-import
- Add only properties that your database actually defines (e.g., Status/Tags must exist in Notion)

---

## Custom Directives

### Callout Blocks

Create highlighted callout boxes with icons.

**Syntax:**

```markdown
:::callout 💡
**Tip:** This is important information that stands out.
Multiple lines are supported.
:::
```

**Features:**

- First line becomes the callout text
- Subsequent lines become child blocks
- Icon (emoji) is required after `:::callout`

**Examples:**

```markdown
:::callout ⚠️
**Warning:** Make sure to review the grammar section first.
:::

:::callout 💭
**Think about it:** How would you use this in conversation?
:::
```

---

### Column Layouts

Create multi-column layouts for side-by-side content.

**Syntax:**

```markdown
:::column-list
:::column
Content for left column.
Can have multiple paragraphs.
:::

    :::column
    Content for right column.
    Also supports multiple lines.
    :::

:::
```

**Features:**

- Supports 2+ columns
- Columns automatically size equally
- Each column can contain multiple blocks

**Examples:**

```markdown
:::column-list
:::column
**Formal:** - Would you mind...? - Could you please...?
:::

    :::column
    **Informal:**
    - Can you...?
    - Will you...?
    :::

:::
```

---

### Table of Contents

Insert an auto-generated table of contents.

**Syntax:**

```markdown
:::toc
```

**Features:**

- Automatically generates from page headings
- Updates dynamically in Notion
- Simple standalone directive

**Typical Placement:**

```markdown
## 2. Your Homework Roadmap

:::toc

## 3. Input Material: The Source
```

---

### Audio Embeds

Embed audio files from external URLs.

**Syntax:**

```markdown
:::audio https://example.com/audio-file.mp3
```

**Use Cases:**

- **Pre-existing audio**: Link to pronunciation guides, example recordings, etc.
- **Not for generated TTS**: The `notion-add-audio` package handles main lesson audio

**Example:**

```markdown
### C. Pronunciation Micro-Focus

Listen to the native speaker pronunciation:
:::audio https://example.com/pronunciation/th-sounds.mp3
```

---

### Video Embeds

Embed videos from external URLs (YouTube, Vimeo, etc.).

**Syntax:**

```markdown
:::video https://youtube.com/watch?v=abc123
```

**Supported Sources:**

- YouTube
- Vimeo
- Other Notion-supported video platforms

**Example:**

```markdown
### Example in Context

Watch this short clip:
:::video https://youtube.com/watch?v=dQw4w9WgXcQ
```

---

### Toggle Headings

Create collapsible headings at different levels.

**Syntax:**

```markdown
:::toggle-h1 Main Section Title
Content that can be collapsed/expanded.
Multiple paragraphs supported.
:::

:::toggle-h2 Subsection Title
Hidden content here.
:::

:::toggle-h3 Detail Level
Even more nested content.
:::
```

**Legacy Support:**

```markdown
:::toggle-heading Generic Toggle
Still works for backward compatibility (creates a generic toggle block).
:::
```

**Examples:**

```markdown
:::toggle-h2 Answer Key

### A. Controlled Practice Answers

1. would travel
2. would buy
3. would learn
   :::

:::toggle-h2 Teacher's Follow-up Plan
**Discussion Points:**

- Review student errors
- Plan remedial activities
  :::
```

**Important:** Both syntaxes are supported:

- `:::toggle-heading Answer Key` (legacy)
- `:::toggle-h2 Answer Key` (new, recommended)

---

### Synced Blocks

Create reusable content that can be referenced multiple times.

**Create Original:**

```markdown
:::synced-block
This content can be synced to other pages.
It only needs to be updated in one place.
:::
```

**Reference Existing:**

```markdown
:::synced-block block-id-123
```

**Workflow:**

1. Create the original synced block in your markdown
2. Import to Notion
3. Copy the block ID from Notion
4. Reference it in other documents using the block ID

---

## Topic Normalization

### The Problem

YAML parsers treat unquoted comma-separated values as arrays:

```yaml
topic: Grammar, Conditionals  # Parsed as ["Grammar", "Conditionals"]
topic: "Grammar, Conditionals"  # Parsed as "Grammar, Conditionals"
```

### The Solution

**Automatic normalization**: Arrays are automatically joined with commas.

```yaml
# These are now equivalent:
topic: Grammar, Conditionals
topic: "Grammar, Conditionals"
topic: [Grammar, Conditionals]
```

**All become:** `"Grammar, Conditionals"` (single string)

### Notion Property Type

- The importer inspects your database. If a `Topic` property exists, its type is respected.
- If `Topic` is missing or is `multi_select`, the importer sends a multi-select payload (splits comma-separated values).
- Otherwise (e.g., rich_text), it sends a single rich text value.

### Best Practice

**For consistency, quote your topics:**

```yaml
topic: 'Grammar, Second Conditional'
```

---

## Complete Example

```markdown
## \`\`\`markdown

title: "Advanced Conversation: Conditional Expressions"
student: Anna
level: B1
topic: "Grammar, Second Conditional, Speaking"
input_type: generate
speaker_labels: [Anna, Teacher]
icon: 💬
cover: https://example.com/covers/conversation.jpg
properties:
Difficulty: "Intermediate"
Duration: "45 minutes"

---

## 1. This Week's Mission Briefing

:::callout 🎯
**Your Goal:** Master second conditional expressions in natural conversation.
:::

## 2. Your Homework Roadmap

:::toc

## 3. Input Material: The Source

### A. Authentic Material

:::video https://youtube.com/watch?v=example

### B. Generated Material

:::column-list
:::column
**Formal Situations:** - If I were you, I would... - If I had more time, I would...
:::

    :::column
    **Casual Situations:**
    - If I was rich, I'd...
    - If I could, I'd...
    :::

:::

:::study-text
[Anna]: If you could travel anywhere, where would you go?
[Teacher]: If I could travel anywhere, I'd visit Japan.
:::

## 4. Language Toolkit: Useful Language

### Pronunciation Guide

:::audio https://example.com/pronunciation/conditionals.mp3

## 5. Practice & Pronunciation

### A. Controlled Practice

1. Complete the sentences...
2. Transform to conditional...
   (8 items total)

### B. Comprehension Check

1. What would Anna do?
2. Where would the teacher go?

## 6. Your Turn: Complete the Mission!

Create your own conditional sentences.

## 7. Why This Mission Helps You

Understanding conditionals helps you...

## 8. Answer Key & Sample Mission

:::toggle-h2 Answer Key

### A. Controlled Practice Answers

1. would travel
2. would buy
   (full answers)

### B. Sample Responses

Example answer: "If I had a million dollars, I would..."
:::

## 9. Teacher's Follow-up Plan

:::toggle-h2 Teacher's Follow-up Plan

**Review Focus:**

- Common errors with "would" vs "will"
- Pronunciation of contracted forms

**Extension Activities:**

- Role-play exercise
- Writing task
  :::
  \`\`\`
```

---

## Migration Guide

### For Existing Files

**Good news:** All existing files work without changes!

### Optional Enhancements

1. **Add icons** to make lessons visually distinctive
2. **Use callouts** for important tips and warnings
3. **Add ToC** to long lessons
4. **Use columns** for comparison tables
5. **Embed media** where relevant

### Recommended Updates

#### Update Answer Key/Teacher's Plan

```markdown
# Old (still works):

:::toggle-heading Answer Key

# New (recommended):

:::toggle-h2 Answer Key
```

#### Quote Your Topics

```markdown
# Old:

topic: Grammar, Conditionals

# New (clearer):

topic: "Grammar, Conditionals"
```

---

## Troubleshooting

### Validation Errors

**Error:** Missing Teacher's Follow-up Plan

**Fix:** Ensure you have either:

```markdown
:::toggle-heading Teacher's Follow-up Plan
```

OR

```markdown
:::toggle-h2 Teacher's Follow-up Plan
:::toggle-h3 Teacher's Follow-up Plan
```

**Note:** Apostrophe character must be one of: `'` `'` `'`

---

### Topic Not Showing Correctly

**Problem:** Topic appears as multiple values

**Fix:** Update to latest version (2.0+) which auto-normalizes topics

---

### Emoji Not Showing

**Problem:** Icon doesn't appear in Notion

**Causes:**

- Icon contains multiple emojis (use only one)
- Icon contains text (must be emoji only)
- Invalid emoji character

**Fix:**

```yaml
# Wrong:
icon: "📚 Book"
icon: 📚📖

# Right:
icon: 📚
```

---

### Nested Directives Not Working

**Problem:** Columns or toggle content not rendering

**Fix:** Ensure proper nesting and closing tags:

```markdown
:::column-list
:::column
Content here
:::
:::column
More content
:::
::: # Don't forget this closing tag!
```

---

## Quick Reference

| Feature           | Syntax                                   | Required? |
| ----------------- | ---------------------------------------- | --------- |
| Page Icon         | `icon: 🎯`                               | No        |
| Page Cover        | `cover: https://...`                     | No        |
| Custom Properties | `properties: { ... }` (must exist in DB) | No        |
| Callout           | `:::callout 💡`                          | No        |
| Columns           | `:::column-list`                         | No        |
| Table of Contents | `:::toc`                                 | No        |
| Audio             | `:::audio URL`                           | No        |
| Video             | `:::video URL`                           | No        |
| Toggle Headings   | `:::toggle-h2 Title`                     | No        |
| Synced Blocks     | `:::synced-block`                        | No        |
| Answer Key        | `:::toggle-h2 Answer Key`                | **Yes**   |
| Teacher's Plan    | `:::toggle-h2 Teacher's Follow-up Plan`  | **Yes**   |

---

## Package Version Compatibility

| Package           | Minimum Version | Features                   |
| ----------------- | --------------- | -------------------------- |
| `notion-importer` | 2.0.0           | All advanced features      |
| `md-validator`    | 2.0.0           | Validates new directives   |
| `md-extractor`    | 2.0.0           | Supports new toggle syntax |

---

## Notes for LLM/Script Authors

When generating markdown files programmatically:

1. **Always quote topic** if it contains commas
2. **Use straight quotes** in YAML frontmatter (`'` or `"`)
3. **Use Unicode escapes** for special characters if needed
4. **Validate** with `md-validator` before import
5. **Test** with `notion-importer --dry-run` first

**Example validation:**

```bash
npx md-validator path/to/lesson.md
npx notion-importer --dry-run path/to/lesson.md
```

---

## Support

For issues or questions:

1. Check validation output: `npx md-validator file.md`
2. Review test fixtures: `packages/notion-importer/tests/fixtures/`
3. See demo: `fixtures/hw/anatoli_new_features_demo.md`

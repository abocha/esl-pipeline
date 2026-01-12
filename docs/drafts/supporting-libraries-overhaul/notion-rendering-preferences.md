# Notion Rendering Preferences Draft

This draft records desired Notion-specific formatting tweaks based on the
reference images in `docs/drafts/supporting-libraries-overhaul/png_reference/`.
These are adapter-level decisions, not changes to the canonical authoring format.

## Answer Key + Teacher Follow-up Plan

Goal: render as simple toggle blocks (not heading toggles) with no color.

Current (undesired):
- Heading toggles (toggle-h2) show as large, highlighted headers.
- Colorizer applies background coloring to the toggle header.

Desired:
- Use plain toggle blocks with standard text weight.
- No colorization applied to these toggles.

Adapter guidance:
- Map the Answer Key and Teacher Follow-up Plan sections to `toggle` blocks,
  not `heading_*` toggles.
- Avoid applying colorizer styles to toggles whose title matches:
  - "Answer Key"
  - "Teacher's Follow-up Plan" (any apostrophe variant)
- Alternatively, skip toggle coloring under sections 8 and 9.

Prompt guidance:
- Keep the content wrapped in a toggle block using `:::toggle` for canonical
  PMD; the adapter renders Answer Key and Teacher's Follow-up Plan as plain
  toggles regardless of the heading level.

## Pronunciation Callout Formatting

Goal: callout shows "Target: ..." as the callout title line, followed by plain
text paragraphs with bold labels (not bullet list items).

Current (undesired):
- Callout body uses bullet list items for Target/Focus/Action/Deliverable.

Desired:
- Callout title line: `Target: ...`
- Body lines as plain paragraphs:
  - `**Focus:** ...`
  - `**Action:** ...`
  - numbered examples as a normal ordered list
  - `**Deliverable:** ...`

Adapter guidance:
- If the callout content begins with `Target:`, render it as the callout's main
  rich_text, not a list item.
- Preserve ordered lists as ordered lists.
- Render Focus/Action/Deliverable as paragraphs with bold labels.

Prompt guidance:
- For pronunciation callout, output the Target line first (no bullet).
- Use bold labels for Focus/Action/Deliverable in plain paragraphs.

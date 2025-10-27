# Changelog

All notable changes to this project will be documented here. Dates use `YYYY-MM-DD`.

## [1.0.0] - 2025-10-27

### Highlights
- **Rich Markdown to Notion mapping.** Bold, italic, inline code (rendered red), strikethrough, nested bullet hierarchies, indented paragraphs, and headings inside toggles now round-trip from Markdown into Notion rich text automatically. YAML frontmatter is skipped entirely.
- **Toggle-aware styling.** Toggle bodies reuse the Markdown parser so inner `###` headings pick up preset colouring and internal lists stay nested.
- **Audio placement fix.** ElevenLabs audio blocks are inserted above the `study-text` toggle instead of inside it. Existing audio is replaced only when requested.
- **Release hygiene.** Added a canonical publishing checklist and this changelog to support tagged releases.

### Other Improvements
- Tightened tests across the Notion importer, colorizer, and audio packages.
- Cleaned up documentation for environment setup, presets, and orchestrator workflows.
- Interactive wizard now defaults to the `NOTION_DB_ID` environment variable (prompted immediately after student selection) and still allows custom database input.

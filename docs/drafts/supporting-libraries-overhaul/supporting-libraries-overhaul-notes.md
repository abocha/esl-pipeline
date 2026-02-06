# Supporting Libraries Overhaul Notes (Draft)

This draft captures decisions and open questions from the review discussion.
It is a working checklist for the refactor plan.

1. TTS file I/O

- Switch `buildStudyTextMp3` to async file reads (best practice, no behavior change).

2. S3 upload guardrail

- Keep current simple upload path.
- Add a max file size guardrail with a default of 50 MB.
- Make the limit configurable via env (`S3_UPLOAD_MAX_MB`).
- Update env docs to include the new variable.

3. Notion adapter consolidation

- Centralize Notion client creation + retry/backoff policy.
- Treat Notion as an adapter behind the PMD AST; avoid Notion-specific logic in core parsing.
- Update PMD draft to reflect this (done).

4. Logging policy

- Avoid `console` in core libraries.
- Surface warnings/errors via structured results; CLI/orchestrator decides what to print.
- Keep CLI behavior as LTS-style convenience, but not the core API contract.

5. md-extractor trimming vs TTS sanitization

- Validation should gate correctness; TTS should own speech-friendly sanitization.
- Current trimming removes whitespace only; it does not remove markdown punctuation.
- Keep existing behavior for now; revisit once PMD parser exists.
- Open question: should md-extractor return raw vs sanitized lines, or only raw?

6. Notion property mapping

- Support all property types that Notion accepts to avoid failing valid input.
- Use DB schema to map each property value to correct type shape.
- Avoid setting Notion-generated properties (rollup/created*/last_edited*).
- Note: auto-syncing student relations is a separate feature idea (track, but not required here).

7. Breaking changes strategy

- OK to break as needed; keep a written restoration checklist.
- Prioritize correctness and best practices; fix regressions before shipping.

8. Notion color-headings package

- Deprecate `@esl-pipeline/notion-color-headings`.
- Mark for full retirement (no migration needed).

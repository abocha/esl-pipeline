# ESL-40 effective request baseline

These synthetic request captures were obtained **before builder/provider consolidation** at
`31b827d1` (current main at implementation start; includes ESL-38 / PR #371 and ESL-39 / PR #374).
Fake fetch exercised the real OpenAI Responses, Google and OpenRouter structured adapters.
Schemas are represented by SHA-256 over their exact serialized JSON to keep the fixtures compact.
No live provider or learner data was used.

The baseline command covered `application.memory-effective-request`, `application.profile-draft-refresh`,
`application.profile-candidate-promotion` (13 tests), then `application.legacy-profile-normalization`
(2 tests). Capture mode was temporary and is absent from the final test helper; these historical
fixtures must not be regenerated from new builders to make a regression pass.

The neighboring `memory-generation-after/*.txt` fixtures pin the reviewed trusted instructions.
The tests compare actual wire bodies to the old source input, schemas, reasoning/verbosity, model,
output caps and transport settings; all supported providers must send the new effective content
even if a stale text prompt is also supplied. The intentional reconciliations are:

- Lesson: retain student-helper disambiguation, STT-noise handling, explicit facts, moderate inference,
  confidence and authority guidance alongside the envelope's manifest-citation requirement.
- Full snapshot: retain observed-performance versus assigned-practice roles, strengths/issues/backlog,
  progress/facts/directions and confidence guidance alongside manifest evidence validation.
- Incremental snapshot: retain bounded update, valid prior facts, contradiction-only de-emphasis,
  previous-snapshot citations, deduplication and compactness.
- Profile refresh: retain full foundational JSON refresh, durable teacher truths, selected facts,
  concise arrays and teacher-only ambiguity guidance.
- Candidate promotion: retain ESL-39's closed candidate-patch decision and backend application.
  The old Google/OpenRouter full-profile rewrite/smoothing instructions conflict with that contract
  and are replaced, while selected-only facts and omission over invention are preserved.
- Legacy normalization: retain durable-versus-transient context and readable teacher-trustworthy
  guidance; replace old Markdown-output instructions with the existing foundational JSON contract.
- Homework: retain the envelope's student-facing targets, teacher cues and review continuity;
  all transports now receive its lineage/publish metadata and source-data boundary.

Dead-path evidence: repository source, CLI/scripts, exports and active docs were searched for
`student-lesson-history`, `TranscriptAnalysisSnapshot`, `StudentLessonHistoryPackageContext`,
`resolveStudentTrackTranscriptUri`, `buildStudentLessonHistory*`, `extractVocabularyFocus`,
`extractGrammarWatchlist`, `buildHeuristicTranscriptAnalysis`, `normalizeTranscriptAnalysis` and
`mergeTranscriptAnalysis`. Only the module's own unused branches and their tests referenced the
retired APIs. `lesson-memory-prompt.ts` calls `extractStudentOnlyTranscript`; its timeline and
multiline student-turn regressions remain. `create-prompt-package.ts` uses canonical
`student-memory-package`, without a transcript-summary fallback. No Batch runtime, migration,
schema, claim, audit or default-off setting was removed. ABO-26 retains that retirement boundary;
ESL-41 owns the approved Google LLM migration, with no new provider framework here.

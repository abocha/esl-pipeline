# AssignmentV1 durable authority and PMD compatibility

## Meta

- Audience: maintainers, prompt authors and implementing agents.
- Authority Level: generation contract and compatibility reference.
- Last Verified Against: 2026-10-03 ESL-5 / ABO-29 local implementation.
- Owner: backend maintainer + founder-maintainer.
- Review Cadence: after assignment schema, renderer or prompt cutover changes.
- Status: `reference`.

## Generation boundary

[ESL-4](https://linear.app/abocha/issue/ESL-4) /
[GitHub #308](https://github.com/abocha/esl-pipeline/issues/308) implements Slice 1.
`packages/contracts/src/assignment-v1.ts` owns the Zod schema, inferred TypeScript domain and
provider JSON Schema. Schema version is `1`, Responses schema name is `assignment_v1`, and the
repository prompt compatibility version is `3.0.0` because old generation packages must be recreated.

The object contains metadata, mission, one input source, declared speakers and turns,
comprehension question/answer pairs, grammar and vocabulary, ordered practice parts with answers,
nullable pronunciation, output task/sample, rationale and teacher follow-up. Optional values are
required nullable properties; every object is closed. Pronunciation uses nested alternatives for
six existing modes. Gender is male/female/neutral; child is represented by age, including in the
PMD speaker profile. Existing legacy gender values and provider catalogs remain supported.

The backend preserves source ownership checks before generation. Fresh packages must select the
active `hw_prompt_assignment_v1.md` revision with the exact first-line declaration
`Assignment output contract: assignment_v1`. The envelope pins `promptVersion: assignment_v1`,
the full strict schema and trusted validation context (canonical student display text, known input
kind and exact URLs supplied in notes/transcript). Revision ID/hash and existing profile, memory,
student and source lineage remain unchanged. An unsupported package returns
`PROMPT_PACKAGE_OUTPUT_CONTRACT_UNSUPPORTED`, instructing the tutor to activate the structured
template and recreate the package. Historical snapshots are never rewritten.

Assignment generation admits only the existing OpenAI `gpt-6.1-sol` target in this slice. Other
assignment overrides fail before budget reservation or dispatch; their other workloads remain
supported. Requests use Responses `text.format.json_schema` with `strict: true`, medium reasoning
and medium verbosity, separate instructions/source input, existing timeout and output/budget limits.
There is one physical request and no serialization repair or provider/model fallback.

Only a completed response with exactly one completed assistant message, expected output text and
no refusal is admitted. JSON must parse directly; wrappers, fences, brace salvage, incomplete and
failed responses are rejected. Incomplete reasons remain actionable. Returned usage is recorded
under the existing safety-mode policy before local validation, including rejected completed output;
failure objects retain request ID, usage and finish reason. Local validation closes object shape,
nonblank content, speaker uniqueness/cardinality/references/use, known source type, complete pairs,
safe supplied URLs and pronunciation payload/chunk/stress consistency. It does not prove pedagogy
or authentic-source fidelity. Length/item-count guidance stays advisory; pronunciation and optional
recording/submission stay optional.

## Compatibility output

`renderAssignmentToPmd` in `html-publisher` owns the single deterministic projection. It supplies
safe YAML, eight existing sections, one study-text block, comprehension immediately after input,
matching speaker labels/profiles, grammar, vocabulary table, controlled practice, six pronunciation
layouts, ordered answer keys/sample and teacher disclosure. Strings cannot create headings,
directives, HTML, links or extra table cells. Newlines in prose normalize to spaces; renderer-owned
numbering/layout carries structure. Supplied media URLs are admitted locally before rendering.

Projection frontmatter carries `assignment_projection: assignment_v1`. PMD decodes its numeric
prose escapes only after structural/delimiter parsing, restoring actual speech text, and admits
word/pair drills without transcription. Historical Markdown parsing remains unchanged. This tag
identifies an escaping convention; it does not grant ownership or establish a durable typed draft.

Slice 1 originally returned projected Markdown. [ESL-5](https://linear.app/abocha/issue/ESL-5)
and the decided [ABO-29](https://linear.app/abocha/issue/ABO-29) bridge now make validated
AssignmentV1 the durable editable authority. Generation/draft DTOs return `format: assignment_v1`,
`assignment`, pinned `validationContext`, and pretty-printed JSON in `text`. The shared
`assignment-artifact.ts` contract defines canonical serialization version 1: sorted object keys,
preserved arrays and exact string content. SHA-256 hashes canonical UTF-8 bytes; textarea whitespace
and key formatting have no identity effect. Immutable objects use content-addressed `.json` URIs.

The whole-document editor is a temporary JSON textarea. It permits invalid local text while typing,
shows syntax/schema-path/domain errors and admits durable autosave only after parse and validation.
Invalid buffers cannot preview, confirm, correct or publish, and have no durable storage. Reload
loads the latest valid object. Existing working-version CAS, conflict-buffer preservation, source
authority, confirmation and lineage remain. Historical rows explicitly use `format: markdown`.

Confirmed Create and jobs freeze format/schema/serialization/working-version/URI/hash references.
Jobs separately pin PMD renderer version 1. Publication and corrections read and integrity-check
that frozen JSON even after later draft edits. PMD, HTML, media, manifest and job identities stay
downstream; no native typed orchestrator/TTS/HTML cutover occurs in Slice 2. Correction requests
carry the exact saved artifact and replay against frozen job/history identity. Ordinary republish
retains its memory-neutral behavior. Typed homework memory consumes the object directly; its dedup
hash is SHA-256 of `assignment_v1:1:<canonical artifact hash>`. Legacy/pending Markdown paths preserve
their prior extraction and hashes, while publication sequence still governs canonical memory order.

Migration 0062 is additive and preserves historical records, freezes draft formats/job references,
and rejects incomplete typed identity. API 7 / DB 2 identify the cutover; schema version 1, prompt,
validator and manifest versions are unchanged. Local evidence covers typed admission, lifecycle,
frozen worker input, mixed reads, memory and migration boundaries; hosted CI remains the merge gate.

## Later authorized rollout and rollback

Repository tests are offline evidence. No production activation or paid call is established here.
Use the [prompt bootstrap runbook](../operations/prompt-gallery-bootstrap.md) and
[deployment procedure](../backend-frontend/DEPLOYMENT.md) under separate authorization.

1. Capture the current code/image, effective assignment target and template selection, active
   template revision/hash, and saved/pending workflow state. Retain the old code/env/revision for rollback.
2. Avoid mixed old/new generation dispatch during cutover. Deploy schema/executor/template support
   together and set `PROMPT_TEMPLATE_PATH` to the shipped structured template. The new runtime
   intentionally rejects old generation packages while saved drafts remain usable.
3. Inspect the bootstrap dry-run. For deliberate review before activation, use the administration
   import operation to create/reuse a draft and record its ID/hash separately from the active revision.
   Bootstrap auto-activates a new asset with no active revision and retires absent old assets; do not
   mistake a full bootstrap apply for a draft-only import. Review, explicitly activate the structured
   revision and verify selection/default through the prompt control plane. Old generation choices
   are excluded in the new source; historical SQL revisions/hashes remain retained.
4. Recreate prompt packages, verify their pinned schema/revision and effective GPT-6.1 Sol settings.
   A separately authorized synthetic paid smoke must verify the submitted provider schema and
   completion/refusal/truncation behavior. Inspect representative handout/audio previews, including
   each supported mode's existing audio capability, before claiming runtime activation.
5. Before typed writes, retain a paired database/object backup and compatible image/template/env
   state. Migration 0062 declares previous-image recovery incompatible, so the deployment planner
   blocks image-only rollback and requires quiescence. Prefer forward repair with typed-capable
   readers while preserving JSON/history. Returning to a pre-Slice-2 image requires the paired
   pre-write restore; it loses later writes and requires separate operator authorization. Never
   relabel JSON as Markdown, drop references or substitute PMD as editable authority. Existing
   historical Markdown stays executable through explicit compatibility readers.

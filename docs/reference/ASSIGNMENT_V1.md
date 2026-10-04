# AssignmentV1 durable authority and native execution

## Meta

- Audience: maintainers, prompt authors and implementing agents.
- Authority Level: generation and execution contract reference.
- Last Verified Against: 2026-10-04 ESL-6 local implementation.
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

## Durable authority and historical compatibility

Slice 1 and Slice 2 used a deterministic AssignmentV1-to-PMD projection. Its renderer version 1
and `assignment_projection: assignment_v1` escaping convention remain readable in historical
Markdown. PMD still decodes numeric prose escapes after delimiter parsing and supports legacy
word/pair drills without transcription. The active projection adapter has been deleted; none of
these historical conventions grants durable authority to Markdown.

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
Slice 2 jobs pinned PMD renderer version 1. Publication and corrections read and integrity-check
that frozen JSON even after later draft edits. HTML, media, manifest and job identities stay
downstream; Slice 2 used transient PMD execution. Correction requests
carry the exact saved artifact and replay against frozen job/history identity. Ordinary republish
retains its memory-neutral behavior. Typed homework memory consumes the object directly; its dedup
hash is SHA-256 of `assignment_v1:1:<canonical artifact hash>`. Legacy/pending Markdown paths preserve
their prior extraction and hashes, while publication sequence still governs canonical memory order.

Migration 0062 is additive and preserves historical records, freezes draft formats/job references,
and rejects incomplete typed identity. API 7 / DB 2 identify the cutover; schema version 1, prompt,
validator and manifest versions are unchanged. Local evidence covers typed admission, lifecycle,
frozen worker input, mixed reads, memory and migration boundaries; hosted CI remains the merge gate.

## Native execution (ESL-6 / Slice 3)

Frozen, integrity-checked AssignmentV1 is passed directly to the orchestrator with its pinned
validation context. It never creates a temporary Markdown file, parses PMD, inserts textual audio
links or routes through Markdown HTML rendering. `md` remains the stable manifest locator for
existing storage/jobs; for typed jobs it is a virtual path, not an editable or materialized source.
Typed `mdStorageUri` refers to frozen JSON. Historical jobs without `assignmentArtifact` retain
explicit Markdown execution, materialization, preview and sharing readers.

Shared study/pronunciation domain types belong to `contracts`; PMD reexports them for historical
consumers. Typed speaker labels, profiles, ordered segment IDs, provider/model selection, cast,
speech-plan provenance and audio hashing keep the established identities. Typed speech is plain
text, so literal punctuation is not stripped as Markdown. The enhancer receives deterministic
JSON containing the complete assignment; authored segments remain immutable. All six pronunciation
modes use deterministic ordinal clip IDs and item-index/side associations, with existing primary,
chunk, upload replacement and unselected-family reuse semantics.

`renderAssignmentToHtml` builds the eight-section handout directly. It shares the existing page
shell, responsive styles, disclosures and media URL policy; domain text is HTML-escaped, safe video
URLs use the existing embed builder, and pronunciation JSON escapes script delimiters. Grammar,
vocabulary, comprehension, ordered answers, stress/chunk layouts and audio controls remain present.
Typed preview validates and renders the same object, with disabled unavailable clip controls.
Markdown `rawHtml` and textual pronunciation fallbacks are historical-only capabilities.

New typed jobs pin renderer version 2. Native manifests use schema 6 with `assignmentHash` and
versioned `publication` (title, icon and nullable study/main-pronunciation URLs). In schema 6,
`mdHash` equals the canonical AssignmentV1 hash; schemas 1–5 keep their historical Markdown hash
meaning. Typed job DTOs expose publication metadata; the bot uses it directly and never scrapes
Markdown or HTML for typed jobs. Historical renderer-1 manifests/audio shapes remain readable.
Native missing-manifest reruns require the durable manifest, while historical recovery remains.
New rerun jobs pin renderer 2 even when their source publication used renderer 1; the source job's
frozen renderer and artifact identity remain unchanged.

API contract 8 and manifest contract 4 explicitly identify the typed source/path and schema changes.
Assignment schema/serialization version 1, prompt 3, validator 2.1 and DB 2 remain unchanged.
Migration 0063 expands the job identity constraint to admit renderer 2 alongside renderer 1,
preserving all artifact checks, historical rows and the frozen-identity trigger. It must precede
native Create/correction/rerun writes. Prior Slice 2 executors reject renderer-2 jobs, so its runtime
compatibility metadata blocks previous-image recovery after native writes. Legacy-data retirement
and Slice 4 remain outside this change. Focused offline regression coverage is local evidence;
hosted PR CI and a separately authorized rollout remain later gates.

## ESL-6 local completion evidence (2026-10-04)

Focused offline suites passed across final runs and targeted repairs:

| Surface | Files / tests | Evidence |
| --- | --- | --- |
| Orchestrator | 7 / 57 | Native no-file/no-PMD execution, six modes, deterministic ordering, primary/chunk reuse, selected replacement uploads, optional audio, native/legacy manifests and planner behavior |
| TTS core and three providers | 4 / 132 | Typed cast/cache parity with unchanged historical speech, literal text, immutable authored words and existing provider/plan regressions; catalogs/synthesis mocked or preview-only |
| HTML | 4 / 46 | Eight-section layout, disclosures, grammar/vocabulary, six pronunciation modes, duplicate-text clip associations, responsive shell, hostile text/media safety and historical regressions |
| Backend pure | 11 / 112 | Frozen input and corrections, materialization, rerun/recovery, typed/legacy metadata, contextual prompt and version contracts |
| Backend HTTP preview | 1 / 32 | Authenticated typed validation/native preview plus existing legacy preview and admission cases |
| Telegram sharing | 1 / 13 | Direct typed title/icon/audio metadata with no fetch, plus historical sharing/approval behavior |

These are 392 distinct focused tests, not a repository-wide gate. Commands used the root
`vitest.config.ts` with explicit file selectors for orchestrator/TTS/HTML/bot, and the backend's
package config with explicit `pure` or `http` projects. Builds passed for contracts, PMD, TTS core,
all three providers, HTML publisher and orchestrator; backend/orchestrator/bot typechecks passed.
Changed TypeScript passed Biome and `git diff --check`. Contract consistency and documentation
structural checks passed (PR freshness mode; two unrelated operations-doc advisories).

The subsequent pre-commit semantic review fixed three risks: renderer-2 inserts rejected by the
existing database constraint, typed reruns inheriting historical renderer-1 execution metadata,
and typed speaker tokens routing to a fallback voice after historical whitespace/underscore
normalization. Ten focused tests passed with these selectors:

- Root `vitest.config.ts`: ElevenLabs `index.hashing-pronunciation.test.ts` with
  `-t "typed.*cast|typed dialogue"` (3 tests); Google/Inworld `index.test.ts` and TTS core
  `speech-plan.test.ts` with `-t "native typed cast|literal typed markup"` (3 tests).
- Backend `pure`: `application.rerun.test.ts` with
  `-t "typed publications|native manifest|recovers a durable html manifest"` (3 tests).
- Backend `migrations`: `integration.migrations.test.ts` with `-t "0063 admits native renderer"`
  (1 test), against a disposable local PostgreSQL 18 database. The test proves renderer 2 fails
  before 0063, succeeds afterward, and preserves history and frozen identity.

Contracts rebuilt; targeted Biome and diff checks passed (one pre-existing migration-test lint
advisory). The generated baseline changed only the renderer constraint and 0063 ledger entry.
Baseline generation/verification used canonical helpers with committed LF migration bytes and
local Docker port translation; verification and `pnpm release:verify:contracts` passed. Earlier
broad completion evidence was retained without rerunning it. No material review findings remain.

At the local completion checkpoint, changes were uncommitted on
`codex/esl-6-native-typed-pipeline`. No commit, push, PR, hosted CI, deployment, paid/live-provider
request or Slice 4 work was performed during that checkpoint. Hosted checks and
production verification of Slice 3 remain outside this local completion boundary. Slice 2 deployment
and production verification are supplied prerequisites for this task, not claims established by
these local tests.

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
   state. Migrations 0062 and 0063 declare previous-image recovery incompatible, so the deployment
   planner blocks image-only rollback and requires quiescence. Prefer forward repair with typed-capable
   readers while preserving JSON/history. Returning to a pre-Slice-2 image requires the paired
   pre-write restore; it loses later writes and requires separate operator authorization. Never
   relabel JSON as Markdown, drop references or substitute PMD as editable authority. Existing
   historical Markdown stays executable through explicit compatibility readers.

# AssignmentV1 durable authority and native execution

## Meta

- Audience: maintainers, prompt authors and implementing agents.
- Authority Level: generation and execution contract reference.
- Last Verified Against: 2026-10-05 ESL-7 local completion.
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
six existing modes. Gender is male/female/neutral; child is represented by age, in the typed speaker profile. Existing legacy gender values and provider catalogs remain supported.

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
Markdown bytes. The active projection adapter and parser have been deleted; none of these
historical conventions grants durable authority or executability to Markdown.

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
hash is SHA-256 of `assignment_v1:1:<canonical artifact hash>`. Legacy extraction/replay is retired;
existing memory entries and hashes remain inspectable. Publication sequence still governs canonical memory order.

Migration 0062 is additive and preserves historical records, freezes draft formats/job references,
and rejects incomplete typed identity. API 7 / DB 2 identify the cutover; schema version 1, prompt,
validator and manifest versions are unchanged. Local evidence covers typed admission, lifecycle,
frozen worker input, mixed reads, memory and migration boundaries; hosted CI remains the merge gate.

## Native execution (ESL-6 / Slice 3)

Frozen, integrity-checked AssignmentV1 is passed directly to the orchestrator with its pinned
validation context. It never creates a temporary Markdown file, parses PMD, inserts textual audio
links or routes through Markdown HTML rendering. `md` remains the stable manifest locator for
existing storage/jobs; for typed jobs it is a virtual path, not an editable or materialized source.
Typed `mdStorageUri` refers to frozen JSON. Historical jobs without `assignmentArtifact` are
read-only. Their original bytes and already-produced outputs remain available under normal retention.

Shared study/pronunciation domain types belong to `contracts`; PMD has been deleted. Typed speaker labels, profiles, ordered segment IDs, provider/model selection, cast,
speech-plan provenance and audio hashing keep the established identities. Typed speech is plain
text, so literal punctuation is not stripped as Markdown. The enhancer receives deterministic
JSON containing the complete assignment; authored segments remain immutable. All six pronunciation
modes use deterministic ordinal clip IDs and item-index/side associations, with existing primary,
chunk, upload replacement and unselected-family reuse semantics.

`renderAssignmentToHtml` delegates the eight-section handout to learner-handout's deterministic
React Node document renderer. Domain text is escaped, safe source/media URLs are admitted explicitly,
and pronunciation clips bind by item index and minimal-pair side. Typed preview uses the same renderer
with generating placeholders and disabled unavailable controls. h2/h3 preset colors remain explicit
presentation inputs. The old native string renderer and its theme/features system are removed.

New typed Create/approval, correction/retry and rerun jobs pin renderer version 3. Worker execution
admits v3 only. Both native manifest producers record v3; publication readback uses the stored job
renderer when manifest publication metadata is absent, so v3 cannot fall back to v1. Native manifests
retain schema 6, canonical `assignmentHash`, and publication schema 1 (title, icon and nullable
study/main-pronunciation URLs). `mdHash` equals the canonical AssignmentV1 hash. Native reruns require
a durable schema-6 manifest; missing-manifest reconstruction and legacy recovery remain retired.

Migration 0065 expands database admission to v3 without rewriting historical migrations, job/artifact
identity or test artifacts. The frozen-identity trigger remains unchanged. Runtime compatibility is
incompatible because previous executors cannot execute renderer 3. Assignment schema/serialization
version 1, publication schema 1 and manifest schema 6 are unchanged. ESL-20's frozen snapshot/hash
remains authoritative. HTML artifact hashing still uses SHA-256 of UTF-8 `html-v1:` plus exact emitted
HTML bytes and the existing default hash-derived key; renderer v3 does not version that namespace.

Learner-handout ships React runtime dependencies and CSS/playback assets beside its compiled module.
Orchestrator keeps html-publisher external to its bundle to preserve asset lookup. Compiled package
checks render through built html-publisher in plain Node without Vite, DOM, network or clock inputs.
Root `rationale` and the teacher follow-up disclosure remain unchanged for the next ABO-32 audience
slice. Already-issued legacy standalone HTML is independent of this path. No deployment is implied.

## ESL-6 local completion evidence (2026-10-04)

Focused offline suites passed across final runs and targeted repairs:

| Surface                      | Files / tests | Evidence                                                                                                                                                                                 |
| ---------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orchestrator                 | 7 / 57        | Native no-file/no-PMD execution, six modes, deterministic ordering, primary/chunk reuse, selected replacement uploads, optional audio, native/legacy manifests and planner behavior      |
| TTS core and three providers | 4 / 132       | Typed cast/cache parity with unchanged historical speech, literal text, immutable authored words and existing provider/plan regressions; catalogs/synthesis mocked or preview-only       |
| HTML                         | 4 / 46        | Eight-section layout, disclosures, grammar/vocabulary, six pronunciation modes, duplicate-text clip associations, responsive shell, hostile text/media safety and historical regressions |
| Backend pure                 | 11 / 112      | Frozen input and corrections, materialization, rerun/recovery, typed/legacy metadata, contextual prompt and version contracts                                                            |
| Backend HTTP preview         | 1 / 32        | Authenticated typed validation/native preview plus existing legacy preview and admission cases                                                                                           |
| Telegram sharing             | 1 / 13        | Direct typed title/icon/audio metadata with no fetch, plus historical sharing/approval behavior                                                                                          |

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
   historical Markdown stays read-only; never restore legacy execution as a compatibility fallback.

## Legacy retirement (ESL-7 / Slice 4)

[ABO-30](https://linear.app/abocha/issue/ABO-30) makes historical Markdown immutable inspection/download
records. Original assignment/source bytes, transcripts/URLs/attachments, published static HTML,
produced media/downloads, manifests, prompt revision/package provenance, jobs/actions, hashes,
timestamps and audit/retention data remain under normal retention. SQL columns and objects are not dropped.

No legacy correction, edit-and-republish, rerun, regeneration, retry, resume, recovery, TTS, HTML
rendering, publication, model conversion or downstream memory processing is supported. APIs reject
legacy actions explicitly with `legacy_assignment_read_only`; Markdown validation is a retired endpoint.
AssignmentV1 is the only execution input. There is no parser fallback or invisible conversion.
The UI opens history for inspection with processing controls unavailable. Sharing existing outputs uses
persisted publication metadata and links, never Markdown/HTML scraping.

PMD, md-validator, assignment Markdown normalization/parsing/rendering, source cache, temporary
materialization, textual audio insertion and scraper recovery are deleted after their consumers retire.
Workspace dependencies, lockfile, development Compose dependency mounts and CI routing follow the
remaining typed graph. API contract 9 and validator contract 3 explicitly mark this removal.

### Cutover and rollback boundary

Migration 0064 is a separately authorized deployment prerequisite, not a live action performed by
local implementation. Stop and quiesce old API/executors/queue consumers before applying it. Resolve
running legacy jobs, remotely submitted legacy homework Batch work, and historical profile-enrichment
provider reservations before migration; the migration refuses unquiesced work. Cancellation is
asynchronous: OpenAI `cancelling` maps to persisted `in_progress`, not `cancelled`. Refresh every
remotely submitted legacy homework run with the updated Batch tool's `status` or `poll` action before
cutover, including existing `cancelled` and `reconciled` rows. The tool records the actual remote status,
Batch identity and observation time in `operator_audit.remoteStatusConfirmation`, retaining other audit
fields. Migration 0064 requires matching terminal remote evidence; old persisted state alone is
insufficient. These separately authorized status polls inspect provider state and do not regenerate
or reconcile historical homework. See [the Batch operations contract](../operations/student-memory-replay-backfill.md#disabled-openai-batch-replay). Retain paired SQL/object backups and immutable prior image IDs.
The migration terminalizes queued/approval legacy jobs, pending legacy memory/Batch execution, and
historical initial-profile enrichment in `waiting_evidence`, `queued` or `result_ready`. Historical
`submitting` or `uncertain` enrichment requires separately verified quiescence and resolution before
migration; never manufacture a completed provider outcome. Admission, recovery, dispatch and profile
publication use the same historical-session predicate. Frozen operations retain generation input,
validated results, hashes and provenance while executable reopening is rejected.

Do not run mixed old/new executors. Reconcile/delete obsolete legacy queue deliveries through normal
queue operations after SQL terminalization; new workers also reject retained legacy deliveries before
processing. Preserve static output routes and object retention. Use forward repair with typed-capable
readers for rollback; image-only rollback to an executor that can revive Markdown is incompatible.
Any paired restore is separately authorized and must account for post-cutover writes.

### ESL-7 local completion evidence (2026-10-05)

Local changes are uncommitted on `codex/esl-7-retire-markdown-runtime`. No commit, push, PR,
merge, hosted CI, release, deployment or live provider request was performed. This is the
local completion boundary for [ESL-7 / GitHub #311](https://github.com/abocha/esl-pipeline/issues/311).

- Backend pure project: 1,041 tests passed. HTTP generation/preview: 18 tests passed. These cover
  retired Markdown admission, native validation/rendering, legacy queue delivery rejection,
  correction/rerun boundaries, historical GET without replay, and superseded historical memory
  delivery without downstream snapshot regeneration.
- PostgreSQL 18 on a disposable local database: the migration 0064 acceptance case passed
  (19 other migration cases deliberately not selected). It proves quiescence refusal, legacy
  terminalization, retained snapshots/provenance/outputs metadata, write/reopening rejection and
  continued typed admission. Generated `schema.sql` restores and matches all migrations:
  `verifySchemaBaseline` returned `{ "ok": true, "errors": [] }`. The local Docker dump adapter
  translated the host-mapped test port to container port 5432; production baseline code was unchanged.
- PostgreSQL source/Create confirmation, schedule projection and tenant authority: 59 tests passed;
  job repository: 15 tests passed. The assignment-session repository's original 49 cases were
  closed by the initial 44 passes and the five corrected native-fixture cases. After the final
  native-only repository cutover, frozen confirmation, concurrent Share reservation and correction
  replay passed again (three selected cases). Historical standalone ownership/status/provenance/SSE
  remains readable while Markdown submission and rerun are rejected.
- PostgreSQL/Redis Share recovery and memory replay: 28 tests passed sequentially, including
  duplicate delivery, cancellation, post-commit recovery and native lineage ownership. A temporary
  overlapping service run was discarded after shared fixture resets collided.
- Frontend minimal workflow, sandbox and prompt-template suites: 278 tests passed. The final
  historical UI suite passed seven tests, including a static-output history resume with all
  processing controls unavailable and no correction/retry/generation calls.
- Orchestrator: 67 tests passed. Typed publisher/provider suites: 352 tests passed; core/bot suites:
  163 tests passed. The ElevenLabs provider integration fixture passed 14 tests. Builds/declarations
  and backend/frontend typechecks passed; Vite reports its existing large-chunk advisory.
- Frozen dependency installation, strict dependency audit, contract version consistency,
  orchestrator library boundary, Compose lint, CI ownership/backend project routing (51 tests),
  generated documentation indexes and active documentation checks passed. Changed source formatting
  and `git diff --check` passed; existing advisory lint warnings are not claims of a clean repository gate.

Raw local check reports are retained under ignored `tmp/esl7-local/`. Test containers are disposable;
existing user smoke services are untouched. Hosted CI and production cutover remain separately owned
steps. Migration 0064 and this executor cannot be rolled back to a Markdown-capable image.

### Focused reviewer-finding corrections (2026-10-05)

The final read-only review found two executable paths: premature Batch cancellation terminality and
historical initial-profile enrichment recovery. Both are corrected locally. The updated migration
acceptance case passed, including stale `cancelled` rows, `cancelling` provider responses, unresolved
enrichment reservations, retained validated-result evidence and rejected reopening. Batch mapping and
transport tests passed 15 cases. PostgreSQL enrichment/history tests passed 13 selected cases; a
separate native regression selection and remote-status persistence check passed 17 cases. They cover
historical admission/recovery/result-ready publication, deferred dispatch, late provider responses,
matching remote Batch identity, preservation of audit fields and refresh of previously reconciled runs.
Backend build/typecheck, updated schema-baseline generation and restore/equivalence, formatting,
contract consistency and active docs checks passed. Reports are retained in `tmp/esl7-local/review-*.log`.
No live-provider calls, production prevalence check or external mutation was performed.

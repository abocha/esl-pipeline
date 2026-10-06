# AssignmentV1 activation preparation (ESL-29)

## Meta

- Audience: maintainer and production operator.
- Authority Level: task-specific rollout handoff.
- Last Verified Against: 2026-10-06 repository and read-only production inspection.
- Owner: founder-maintainer.
- Review Cadence: before executing this rollout or changing its release inputs.
- Status: `runbook`.

## Decision and boundary

The final changed-policy gate is **KEEP**. The maintainer's
[ESL-31 conclusion](https://linear.app/abocha/issue/ESL-31/re-evaluate-repaired-assignmentv1-generation-before-activation)
at 2026-10-06 10:36:27 UTC confirms activation support after remediation; the current ESL-29
instruction accepts it as sufficient evidence. Earlier v5/v6 CHANGE records remain history.
Do not rerun their frozen evaluation helper or seek additional quality confidence.

This is preparation only. Push, PR creation/merge, release, production image/checkout/deploy-plan
work, backup/restore, migration, activation and default changes await separate authorization.
None was executed here. A deploy `--plan` can pull/alias images and write host state, so it is
not a read-only production probe.

## Repository and production snapshot

Preparation started clean on `codex/assignment-v1-compatibility-guardrail` at
`371d73531cdfd70012323faa090e93e209caa1c9`; the remote branch matched. `main` was
`9ea639e0e98db5dce74c24fd96e00800cda006ac`. No PR or hosted run existed for the feature branch.
All 15 campaign commits, from ESL-20 through final ESL-31 repair, are present. No additional
application, template, migration, environment or compatibility code change is required.
The local preparation delta is this handoff, its router link and the final KEEP annotation.

| Surface             | Intended release                                                                 | Production observed                                             |
| ------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Assignment identity | AssignmentV1 schema/serialization 1; ESL-20 identity unchanged                   | Native AssignmentV1 supported                                   |
| Generation          | `assignment_v1_generation_v7`, matching first-line marker and full strict schema | Bare `assignment_v1` template marker                            |
| Publication         | renderer 3; React learner-handout via html-publisher                             | Previous renderer runtime                                       |
| DB migration head   | `0065_assignment_react_renderer`                                                 | `0064_historical_markdown_read_only`                            |
| Canonical template  | shipped `hw_prompt_assignment_v1.md`, v7 bytes below                             | active v2, revision `53de5edc-9e43-4f85-bf26-7d0405313482`      |
| Effective default   | `hw_prompt_assignment_v1.md`                                                     | `hw_prompt_definitive.md`; DB default overrides configured path |

Running application images and `/var/lib/esl-pipeline/deploy/current-images.env` identify
`9ea639e0e98db5dce74c24fd96e00800cda006ac`. The VPS checkout is clean at
`3c1110dbfbb2ea06c770760b0d9d24ecd3565fec`: checkout head is not running-image identity.
API health passed. All 64 applied migration checksums match this branch's committed LF bytes.
Only 0065 is pending. It expands renderer admission from 1/2 to 1/2/3, preserves the existing
frozen-identity trigger, and rewrites no artifacts. Packaged compatibility metadata declares it
**incompatible**, requiring stopped application writers and blocking old-image-only rollback.

All jobs were terminal (`458 succeeded`, `40 failed`). Active/waiting/prioritized/delayed counts
were zero for `esl-jobs`, `transcribe-queue` and `student-memory-queue`. Refresh these counts
immediately before cutover and let newly arrived ordinary work finish. No historical work is
replayed as a rollout check. Available host/Docker space was 39,727 MiB, above the deploy floor.

Production already has `ESL_PIPELINE_CONFIG_PROVIDER=local`, `PG_ENABLED=true`, and
`PROMPT_TEMPLATE_PATH=packages/batch-backend/prompt-assets/templates/hw_prompt_assignment_v1.md`.
No environment addition/removal/change, Compose topology change or provider-side schema
registration is needed. The application supplies the schema in each fresh request envelope.

## Release and exact activation identity

Submit the complete branch to `main`, with exactly one label: **`release:major`**, reflecting
rejection of previous executable renderer/generation pins. Runtime prompt assets cannot use
`release:none`. The 15 campaign commits are already remote; push is needed for preparation docs.
Local PR text is prepared in ignored `.tmp/esl-29/pr-body.md`.

Current classifiers select backend, frontend and Telegram bot builds: `pnpm-lock.yaml` is a
shared image input, contracts affect all three targets, and `scripts/evaluation/assignment-quality.ts`
is an unclassified path handled fail-closed. Leave routing unchanged. The backend Dockerfile
builds/deploys learner-handout JS, CSS/playback assets and React dependencies through the workspace
graph and copies prompt assets into `/app`. There is no per-assignment Vite build or separate
learner-handout service; orchestrator keeps publication external for package-relative assets.

`Release On Merge` creates a bot-authored release commit/tag and publishes the complete GHCR
bundle. Deploy that **40-character release SHA**, which does not yet exist, rather than substituting
feature or merge head. Backend digest change recreates API, all three workers, frontend and Caddy.
Postgres/Redis remain running. The Telegram service is currently absent; include it only if the
existing ops-bot profile is enabled. Edge configuration does not change.

The exact committed LF template SHA-256 is
`2bcf441b4928f8ff10becfabb5dad37a9412fef94adfe9c3c77a0eac0de78bc2`.
Its first line is `Assignment output contract: assignment_v1_generation_v7`.
The full schema object (`JSON.stringify(ASSIGNMENT_RESPONSE_SCHEMA)`) SHA-256 is
`d7b665f26953ede984e438d0586336dc29c9320d0883d7e209fa6442caf07af1`.
Admin import hashes exact deployed UTF-8 bytes. Fresh envelopes use that revision plus the existing
source-data boundary and shipped strict schema. Prompt compatibility stays `3.0.0`, envelope
read-format `assignment_v1`, publication schema 1 and manifest schema 6.
Old v6/bare template markers and mismatched/obsolete package schema pins intentionally fail before
dispatch. Do not edit historical packages, silently upgrade them or add obsolete-contract compatibility.

## Execution order after authorization

1. Push preparation docs, create the campaign PR, require selected hosted checks, `CI gate` and the
   release-label guard, then merge. The classifiers select build/unit, integration, backend DB/worker,
   media, Telegram and backend production packaging. Hosted CI owns comprehensive validation.
2. Require a successful complete release bundle; record release tag/SHA/digests. Update the clean VPS
   checkout to reviewed release scripts/config without changing `.env`, uploads or deploy state.
   Preserve current image refs and template/default identifiers below. Before deploy overwrites its
   normal previous-state file, copy `current-images.env` to
   `/var/lib/esl-pipeline/deploy/esl29-<release-sha>-before-images.env` with mode 0640;
   refuse to overwrite an existing capture. This is a separately authorized host-state write.
3. Inspect the normal plan using the release SHA, then deploy:

   ```bash
   cd /opt/esl-pipeline
   sudo bash scripts/deploy/deploy-prod-images.sh <40-char-release-sha> --plan
   sudo bash scripts/deploy/deploy-prod-images.sh <40-char-release-sha>
   ```

   Require only 0065 pending, quiescence true and image rollback unsafe unless intervening reviewed
   state explains a change. The script locks deployment, stops all live Compose application writers,
   takes/verifies the pre-0065 backup, applies packaged migrations once, then recreates services.
   Record the verified `pre_deploy_<short-sha>` dump path and S3 key. Backup/stop failure leaves
   writers stopped. Migration failure does not prove rollback; inspect conservative compatibility state.

4. Require normal HTTP/schema checks and readiness from all three current worker instances. Confirm
   all running API/worker images have v7 schema/template and renderer 3 before activation. Leave the
   old DB template active until then. Fresh creation intentionally fails closed in this interval;
   old workers cannot receive v7. Do not combine activation with application deployment.
5. In **Administration > Prompts**, verify shipped canonical marker/hash, then **Import & activate**
   `hw_prompt_assignment_v1.md`: authenticated admin
   `POST /api/templates/hw_prompt_assignment_v1.md/import-and-activate`. It reads the running asset
   and creates/reuses a hash-matching immutable revision. Record returned revision ID/version/hash;
   require control-plane `active.contentHash == shipped.contentHash`, drift `in_sync`, and v7 marker.
   If import succeeded but activation failed, refresh persisted state and **Activate shipped** for
   that hash. Do not create edited content or activate a stale revision.
6. Make it the default using the existing admin control or
   `POST /api/templates/hw_prompt_assignment_v1.md/default`. Verify effective default via
   `GET /api/templates/control-plane` and fresh prompt options. No global bootstrap is necessary:
   it can retire unrelated templates. Preserve historical revision/package/publication content.
7. Observe the first ordinary, separately authorized fresh generation/publication below. Do not
   republish historical standalone homework or test-era artifacts. Close ESL-29 only after live
   product-path verification; preparation alone does not close the campaign.

## Concrete rollback

| Mutation / point                 | Action                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before 0065 invocation           | Restore stopped services using captured image state at `9ea639e0e98db5dce74c24fd96e00800cda006ac` through normal Compose. No DB rollback is needed if migrations never ran.                                                                                                                                                                                  |
| 0065 invoked/committed/uncertain | Keep writers stopped. Inspect `rollback-compatibility.json`; do not run old images on this DB. Prefer a repaired release retaining 0065, v7 and renderer 3. Returning to the old runtime requires the verified **pre-0065** DB backup and captured old images, together. A retry's backup may already contain 0065.                                          |
| Template activation              | Restore prior canonical revision pointer with the existing admin revision activate endpoint: `53de5edc-9e43-4f85-bf26-7d0405313482`, v2, hash `e30f2309de89c5876725441c9851e2e43009770b48807bc8b27055611f66f356`. With v7 workers this safely blocks fresh creation via unsupported-contract rejection; it does not provide working old-contract generation. |
| Default selection                | Prior default is `hw_prompt_definitive.md`, revision `248cb966-6cc8-45a7-a365-6e7a212fdbd0`, v17, hash `c974f530d0843cef783ad88945e8e314730fca68c55faa0fdfa492702eae8621`. Restore via `POST /api/templates/hw_prompt_definitive.md/default` only to disable activation or as paired recovery. It remains unsupported for fresh v7 generation.               |

For an authorized return to the old runtime, keep all application writers stopped, restore the
exact recorded pre-0065 S3 dump, verify ledger head 0064, admission 1/2 and captured prompt/default
identities, then start the captured old application images:

```bash
sudo bash scripts/docker/postgres-prod-backup-s3.sh restore-remote <pre-0065-s3-dump> --clean
sudo docker compose -p esl-pipeline-prod -f docker-compose.prod.yml \
  --env-file /var/lib/esl-pipeline/deploy/esl29-<release-sha>-before-images.env \
  up -d --no-build --no-deps --force-recreate \
  batch-backend batch-worker transcribe-worker student-memory-worker batch-frontend caddy-edge
```

Confirm the capture names the recorded old release. The deploy script also creates
`previous-images.env`, but retries can replace it; use the retained ESL-29 capture for recovery.
Reconcile `current-images.env` through the authorized normal deployment path only after old schema
verification. Migration 0065 adds no standalone schema objects: it replaces an existing CHECK and
adds a ledger row. This backup restores both plus template/default data. Restoration discards later
DB writes and requires explicit recovery authorization. No manual migration-ledger deletion,
historical republishing or content rewrite is needed. No environment edits need reversal.

## Evidence and minimum live verification

Reused: final KEEP; ESL-31 repair's contracts/handout builds, 87 backend tests across five files and
20 publication-adapter tests (Russian support, English practice/copies/answers, Russian comprehension
questions/explanations, teacher exclusion). ESL-20 fixture/snapshot bytes remain unchanged since
freeze. No quality/provider/pronunciation/media evaluation or compatibility archaeology was rerun.

Preparation passed `pnpm release:verify:contracts` and the required
`pnpm --filter @esl-pipeline/batch-backend run db:verify-baseline` against temporary databases on
the existing local PostgreSQL 18.6 smoke service. The existing `tmp/baseline-local-port.mjs` adapter
maps host 55432 to container 5432 for Docker pg tools. Read-only production ledger/admission,
templates/defaults, images, health and queue checks passed. Logs, ledger and classifier/compatibility
output remain ignored under `.tmp/esl-29/`. Hosted gates remain required and unverified.

The smallest product proof is one **new ordinary assignment** created after activation:

- Saved package: v7 instruction marker, exact full strict schema/object hash above, activated template
  revision/hash matching shipped bytes, prompt compatibility `3.0.0` and read-format `assignment_v1`.
- Saved JSON/job/manifest: schema/serialization 1, job `assignmentRendererVersion` and manifest
  `publication.rendererVersion` 3, manifest schema 6, `assignmentHash` matching frozen artifact hash.
  Running image adapter imports `@esl-pipeline/learner-handout/server`; packaged CSS/playback exist.
- Same emitted HTML, including opened answers: learner rationale visible where supplied; teacher
  rationale absent from the whole DOM; structured mission/grammar roles present; instruction-language
  metadata controls support annotations. English practice prompts/copies/target answers coexist with
  intended support directions/explanations/comprehension questions. Use an ordinary Russian-support
  assignment to observe that boundary. Repeat desktop/mobile inspection only for a concrete live defect.

Retain only this package/revision/job/artifact/publication linkage and observed semantics.
If no ordinary authorized job is available, mark product verification pending. A smoke creating work
or calling providers needs explicit authorization; do not create extra quality cases for confidence.

## Pending protected boundary

Next: push preparation documentation and create the campaign PR. Later authorization covers
merge/release, VPS checkout/image/deploy-plan work, quiescence/backup/migration/deployment,
shipped v7 template import/activation, DB default change and any live smoke creating work.

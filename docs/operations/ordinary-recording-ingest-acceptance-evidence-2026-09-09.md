# Ordinary Recording Ingest Acceptance Evidence — 2026-09-09

## Meta

- Audience: maintainers reviewing the Slice 7 closeout.
- Authority Level: dated local evidence record; not current production truth.
- Source state: `codex/audio-topology` at `f2d198d6`, plus the documented Slice 7 closeout diff.
- Status: `evidence`.

This record reuses the completed Slice 1-6 evidence because the relevant implementation inputs did
not change. It does not claim hosted CI, production migration, paid-provider, deployment, cleanup
enablement, or broad conferencing-export compatibility evidence.

## Goal Contract matrix

| Completion item                                                                     | Classification                                                | Current evidence and boundary                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary supported audio ingest end to end                                          | **COVERED — requires authorized rollout/production evidence** | Local upload, preparation, storage, run, provider-adapter, transcript, DTO, and Source-review seams are covered by focused/integration tests. The real S3-to-ElevenLabs fetch and deployed end-to-end audio smoke remain authorized rollout evidence.                                                                                                      |
| Cheap-demux video in the exact production Docker runtime                            | **COVERED — fresh evidence**                                  | The runtime target built from `packages/batch-backend/Dockerfile` passed `scripts/docker/verify-recording-media-runtime.sh` for MP4/AAC, MOV/AAC, and WebM/Opus. Codec and two channels were preserved; duration deltas were 0, 0, and 0.020 seconds; outputs had no video; logs proved audio stream copy and no mapped video stream.                      |
| Browser/backend size and media rejection                                            | **COVERED — fresh evidence**                                  | Route-visible picker coverage includes every supported direct-audio extension and the MP4/MOV/WebM convenience families. Browser no-request size coverage, 2 GiB boundary checks, 100 MiB bounded-streaming instrumentation, temp-capacity failure, duration, corruption, no-audio, multiple-audio, unsupported, and extraction cleanup tests are current. |
| Transient, ambiguous, and malformed STT recovery                                    | **COVERED — requires hosted CI**                              | Local classification, three-slot exhaustion, committed terminal projection, malformed Deepgram result, and recovery tests are current. Hosted PostgreSQL/Redis worker lanes remain authoritative for service-backed merge evidence.                                                                                                                        |
| Duplicate enqueue/claim/submission safety                                           | **COVERED — requires hosted CI**                              | Real local PostgreSQL/Redis Slice 4 evidence covered duplicate delivery, claim/lease, guarded dispatch, slot reservation, stale recovery, and one transcript winner. Hosted PostgreSQL/Redis reruns and `CI gate` remain merge evidence for the final branch.                                                                                              |
| Tenant isolation on named recording/transcript/cache/retry/access/deletion surfaces | **COVERED — fresh evidence**                                  | The final Slice 6 focused PostgreSQL batch included Source, cleanup, and tenant authority (37 tests), including adversarial cross-workspace access and cleanup ownership.                                                                                                                                                                                  |
| Source confirmation immediately makes audio unavailable                             | **COVERED — fresh evidence**                                  | Transactional confirmation, historical 0053 backfill/trigger, DTO availability, and playback rejection are covered in the final Slice 6 focused evidence.                                                                                                                                                                                                  |
| Retained-audio TTL cleanup                                                          | **COVERED — fresh evidence**                                  | Clock-controlled pending/failed/unconfirmed/stale eligibility, two-sweeper claims, stale completion, filesystem/S3 delete semantics, retry accounting, and retained transcript lineage are covered in the final Slice 6 evidence.                                                                                                                          |
| No successful STT retry for normal users                                            | **COVERED — fresh evidence**                                  | Server rejection plus route-visible UI evidence proves no active/successful retry control; terminal recovery copy directs a new or replacement upload.                                                                                                                                                                                                     |
| Refresh/resume truthfulness                                                         | **COVERED — fresh evidence**                                  | Canonical DTO/polling/SSE/upload-reconciliation/resume tests cover checking, waiting, transcribing, retrying, ready, attention, stale event rejection, replacement races, and same-student resume ownership. A deployed browser smoke remains rollout confirmation.                                                                                        |
| Same-workspace cache-hit lineage with `not_retained`, no run, and no audio          | **COVERED — fresh evidence**                                  | Route, repository, DTO, frontend, and tenant tests prove independent recording/transcript lineage, no storage/run/enqueue, ready projection, and no audio control across refresh/resume.                                                                                                                                                                   |

## Explicit remaining gates

| Gate                                                        | Classification                                                | Required evidence                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installed ElevenLabs SDK `sourceUrl -> source_url` shape    | **COVERED — fresh evidence**                                  | `packages/stt-provider-elevenlabs/tests/index.test.ts` exercises the installed SDK transport, asserts `source_url`, and rejects `file`/`cloud_storage_url`; the large local source remains file-backed without `Blob.arrayBuffer()`. No real provider call was made. |
| Production migration preflight and snapshot/clone rehearsal | **COVERED — requires authorized rollout/production evidence** | Use `ordinary-recording-ingest-rollout.md`; unresolved ownership or duplicate winners stop rollout for operator resolution.                                                                                                                                          |
| Hosted PostgreSQL/Redis lanes and fail-closed CI gate       | **COVERED — requires hosted CI**                              | Required before merge. Local `PASS_WITH_CI_REQUIREMENTS` is not merge-ready.                                                                                                                                                                                         |
| Actual presigned-S3 provider fetch                          | **COVERED — requires authorized rollout/production evidence** | One staged/production ElevenLabs smoke must prove the provider can fetch the real short-lived URL. Failure does not authorize whole-file buffering.                                                                                                                  |
| Recording-source compatibility campaign                     | **COVERED — requires authorized rollout/production evidence** | No Zoom, Teams, Meet, Telemost, LiveDigital, Jitsi, or OBS export is certified by the synthetic gate. Probe representative exports before claiming compatibility or widening the allowlist.                                                                          |
| Cleanup enablement and deployed deletion                    | **COVERED — requires authorized rollout/production evidence** | Keep disabled until candidate inspection, synthetic filesystem/S3 rehearsal, immediate-unavailability check, deletion, and retained-text verification pass.                                                                                                          |

## Reused local evidence

- Slice 2 media closure: 54 ingest/retry/worker/repository/cache tests, 21 media tests, 12 storage
  cleanup tests, migrations, contracts/baseline, and its nine-lane affected gate passed.
- Slice 3 provider submission: 58 focused tests, ElevenLabs adapter/request shape, storage variants,
  128 MiB file-backed source, secrecy checks, typechecks, and
  `tmp/check-logs/2026-09-03T17-27-19-365Z-check-fast-agent/summary.json` passed with hosted DB
  evidence remaining.
- Slice 4: PostgreSQL/Redis concurrency and recovery evidence plus the closed Sol/high exceptional
  risk review; same-student resume focused suites passed 32 tests.
- Slice 5: 93 frontend and 10 backend projection/SSE tests passed; Terra/high follow-up reported no
  remaining findings.
- Slice 6: 131 focused backend tests, 37 PostgreSQL Source/cleanup/tenant tests, 12 migrations, 82
  routing tests, contracts, baseline, typechecks, docs checks, and `git diff --check` passed; Sol/high
  follow-up reported no findings. Its aggregate artifact
  `tmp/check-logs/2026-09-08T06-38-50-077Z-check-agent/summary.json` records the unrelated frontend
  failure and must not be represented as a passing completion gate.

## Docker runtime result

- Final-tree local image: `esl-pipeline-slice7-media-runtime:final`
- Image ID: `sha256:be9c83702d7698138823784419fd37ef18cb48b1cc1b44dedc85cddfeccf0aec`
- Platform: `linux/amd64`
- Runtime: Node `v24.20.0`; FFmpeg/ffprobe `7.1.5-0+deb13u1`
- MP4/AAC and MOV/AAC: two channels preserved, 2.000 -> 2.000 seconds.
- WebM/Opus: two channels preserved, 2.008 -> 2.028 seconds.
- All outputs: no video, audio stream mapped as `(copy)`, no video stream mapped.

Rebuild and rerun the gate for the final intended image/source revision before enabling video. The
deployed image identity, hosted CI run, and rollout observations belong in the PR/deployment record,
not retroactively in this dated local record.

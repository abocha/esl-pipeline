# Replacement-host recovery rehearsal evidence — 2026-10-02

## Meta

- Audience: maintainers reviewing ESL-15 or resuming the rehearsal.
- Authority Level: dated partial evidence; not a successful recovery or production claim.
- Source state: rehearsal tooling at `ba2fffb4bf2b3128e30787db385f78a0aa8b92b4`;
  pinned application at `338e6404148922cfe2bc84a892e0eea474bdd8bf`.
- Owner: [GitHub #328 / ESL-15](https://github.com/abocha/esl-pipeline/issues/328).
- Status: `evidence`.

**Outcome: incomplete.** Work stopped at the user's request after three failed hosted attempts.
No database backup, source-destruction recovery boundary, replacement deployment, or successful
`recovery-result.json` was produced. [PR #329](https://github.com/abocha/esl-pipeline/pull/329)
remains draft and unmerged, with `release:patch`. ABO-10 remains the broader roadmap.

## Saved implementation

The [owning runbook](replacement-host-recovery.md) records the durable-state classification and
recovery order. The command `bash scripts/recovery/run-replacement-host-rehearsal.sh` composes
the ESL-14 host bootstrap, production Dockerfiles, immutable revision labels/local registry
digests, real backup/restore tooling, migration compatibility, normal image deployment, production
Compose, worker readiness, and runtime queue monitoring. It allocates separate Ubuntu 24.04
systemd guests, rejects external targets, and cleans only its own resources.

Synthetic fixtures use application APIs and packaged storage/domain code. The intended transfer
contains a logical PostgreSQL dump, quiet Redis AOF, and local uploads/drafts. Production inputs,
objects, DNS, credentials, hosts, and user/student data were never accessed. The local registry and
S3 emulator substitute for external services; paid providers are disabled and application Internet
egress is rejected. This implementation's full transfer and recovery path remains unverified.

## What failed

| Attempt                                                                                   | Observed result                                                                                                                                                                | Response or remaining diagnosis                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloud environment                                                                         | Managed proxy intermittently returned HTTP 503 with `remote connection failure ... Invalid argument` for npm, GitHub, Node, and image downloads.                               | Rechecked connectivity and preserved proxy/CA trust. Some requests and Git pushes recovered, but uncached builds remained unreliable. No platform network repair was available; hosted disposable Ubuntu runners supplied subsequent evidence.                                                                                             |
| [Hosted run 37032346861](https://github.com/abocha/esl-pipeline/actions/runs/37032346861) | Production application images built and Ubuntu bootstrap passed; loading images into forced VFS guest storage exhausted disk.                                                  | Removed forced VFS selection so Ubuntu Docker selects its normal supported driver.                                                                                                                                                                                                                                                         |
| [Hosted run 37034454669](https://github.com/abocha/esl-pipeline/actions/runs/37034454669) | Images loaded; starting the local registry failed with an invalid nested OverlayFS mount in containerd storage.                                                                | Added an independent disposable volume for `/var/lib/containerd`, alongside `/var/lib/docker`.                                                                                                                                                                                                                                             |
| [Hosted run 37036230113](https://github.com/abocha/esl-pipeline/actions/runs/37036230113) | Source dependencies, migrations, application health, and synthetic API seeding succeeded; source product verification requested `/recordings/undefined` and received HTTP 500. | The rehearsal media handoff lacked `recordingId`. The helper emits JSON and application logs, while the caller selects its last stdout line. Selecting a log instead of the fixture payload is the likely cause, not a confirmed root cause: the raw handoff was not retained. No further fix or run was attempted after the stop request. |

The last failure is in the new rehearsal tooling, not an observed failure of database restore or
replacement deployment. Those phases were never reached. The missing sanitized media payload is
also an evidence gap: the retained error shows the undefined identifier but cannot establish why
the handoff selected the wrong object.

## Strongest observed integration evidence

The final hosted attempt used actual repository bootstrap and production application images on a
pristine disposable Ubuntu 24.04 systemd guest with an independent Docker daemon. It established:

- Bootstrap reported `bootstrapComplete=true`, `externalInputsPresent=false`, and
  `deploymentStatePresent=false` before synthetic inputs were supplied.
- PostgreSQL, Redis, and local S3 dependencies became healthy; the synthetic bucket was created.
- Packaged migration verification found 60 migrations applied, zero pending, and succeeded.
- Prompt-asset bootstrap and backend/frontend health checks succeeded.
- Actual authenticated APIs created a synthetic account, student, lesson, and assignment session;
  their identifiers were retained in `source-product.json`.
- Local registry pulls recorded backend digest
  `sha256:52d1937c5974296ecdc30ba85781115ebd294e4f36e3d4fde8cbc031e554c52b`
  and frontend digest
  `sha256:f80ed81ded1a0c8f2e670d957ef63cfcbba8bfba0280f1a01d4022050722d00d`.

These are source-host setup observations. They do **not** establish restored data, recovered
authenticated reads/media, replacement migration compatibility, public Caddy routing, all three
current-instance worker readiness records, idle queue consumers, or recovered inactive operations
units. The service-backed failure cases for corrupt restore, schema drift, and absent worker
readiness also remain unexecuted.

## Validation and retained evidence

- Nine focused preflight/target-guard tests passed. ShellCheck, Biome, affected Markdown/YAML
  formatting, documentation checks, and whitespace checks passed. Two unrelated documentation
  age warnings were left unchanged.
- [Comprehensive CI 37036230348](https://github.com/abocha/esl-pipeline/actions/runs/37036230348)
  and [release-label guard 37036230253](https://github.com/abocha/esl-pipeline/actions/runs/37036230253)
  passed at `ba2fffb4bf2b3128e30787db385f78a0aa8b92b4`. The separate recovery workflow failed.
- The final save additionally requires frontend JS/CSS MIME types instead of accepting any HTTP
  200 body. This assertion passed local Biome checks, but was not exercised by integration or
  hosted CI. The report/save commit uses `[skip ci]` to honor the request to stop further work;
  it must not inherit the earlier head's green CI claim.
- Hosted artifacts are named `replacement-host-recovery-evidence` and retained for 14 days.
  The final [artifact 11241071700](https://github.com/abocha/esl-pipeline/actions/runs/37036230113/artifacts/11241071700)
  has digest `sha256:0441c5c831b074e996915144a8c7117704a11f9af4e3ebc44eef04279e92e401`.
  Earlier artifacts are attached to the first two linked runs.
- Extracted final logs remain at `/tmp/esl15-hosted-evidence-3` in the current Cloud workspace;
  hosted artifacts are the shareable evidence while retained. No fixture credentials or backup
  bundle was committed. Rehearsal-owned Cloud containers, volumes, and builders were cleaned up;
  unrelated development resources were preserved.

## Remaining work if resumed

Use an explicit file/output contract for the media fixture, validate required identifiers, and
retain its sanitized payload. Then complete one actual dump → source destruction → fresh-host
bootstrap → restore → pinned deployment → verification run. Diagnose only failures reached by
that run, and obtain green hosted checks on the final implementation before considering the PR
ready. Until then, ESL-15's completion boundary has not been met.

Even a successful synthetic rehearsal would not prove production backup coverage/consistency,
pending Redis work recovery, real object access, GHCR identity, credentials/IAM/KMS, VPS/kernel
behavior, SSH/firewalls, DNS/public TLS, providers, RTO/RPO, or production timer activation. Those
still require separately authorized real replacement-host evidence; this work grants no such
authorization and does not establish replaceable-host posture.

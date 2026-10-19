# Operations Router

## Meta

- Audience: operators, maintainers, and agents.
- Read Time: 1 minute.
- Authority Level: router.
- Last Verified Against: 2026-08-12 operations documentation.
- Owner: operations maintainers.
- Review Cadence: after an operational-surface change.
- Status: `router`.

## Current Procedures

For Google Calendar scheduling, callback/security readiness, provider identity proof and reviewed
retirement of unused internal schedules, use [google-calendar-cutover.md](google-calendar-cutover.md).

Use a current runbook for instructions. Start with the relevant entry in
[`docs/reference/DOCS_IA_MAP.md`](../reference/DOCS_IA_MAP.md), or with the deployment,
backup/restore, health, Telegram, prompt-gallery, or replay runbook named there.

For an isolated, no-spend local assignment/UI/API rehearsal, start with
[`local-product-smoke.md`](local-product-smoke.md); it uses a typed AssignmentV1 fixture
and does not run the transcription worker or call paid providers by default.

For a fresh supported Ubuntu host, start with
[production host bootstrap](../backend-frontend/DEPLOYMENT.md#fresh-ubuntu-production-host-bootstrap).

For an existing host with mixed checkout/configuration ownership, use the maintainer-controlled
[production configuration reconciliation](production-config-reconciliation.md). Repository preparation
does not authorize or prove live migration.

For the application and MCP origin cutover to `app.eslpipeline.com`, use
[canonical-domain-migration.md](canonical-domain-migration.md), including DNS-only HTTPS staging,
browser checks, explicit ChatGPT reconnection and same-release environment rollback.

For AssignmentV1 activation, consult the [ESL-29 preparation record](assignment-v1-activation.md)
**only as dated rollout evidence**. Its frozen v7 hashes and release identities predate the current
v8 template/schema contract. Refresh live deployment, template, schema and rollback identities
before proposing any new activation; do not execute the historical v7 instructions unchanged.

For a newly authorized AssignmentV1 quality evaluation, use the current
[evaluation method](assignment-quality-evaluation.md). ESL-28 and ESL-31 are completed historical
outcomes in [`docs/archive/operations/`](../archive/operations/); their paid commands are not a
current authorization or instruction to repeat those calls.

For on-host container, filesystem, CPU/memory-pressure, and public-route checks, see
[`host-runtime-health.md`](host-runtime-health.md). It is separate from PostgreSQL backup health
and does not establish off-host availability or worker job progress.

Ordinary lesson-recording rollout uses
[`ordinary-recording-ingest-rollout.md`](ordinary-recording-ingest-rollout.md) for migrations,
runtime media verification, run/reservation inspection, and staged enablement, plus
[`recording-audio-cleanup.md`](recording-audio-cleanup.md) for the disabled-first deletion rehearsal.

## Dated Evidence and Incidents

Dated evidence records what a bounded run, rehearsal, evaluation, or incident observed. It may
support a decision, but it never replaces a current procedure or proves current production state.
Verify its cited source revision, date, and any current state before relying on it.

Examples include:

- [`hosted-mvp-evidence.md`](hosted-mvp-evidence.md)
- [`speech-planner-evaluation-evidence-2026-07-29.md`](speech-planner-evaluation-evidence-2026-07-29.md)
- [`study-text-performance-v3-luna-evidence-2026-08-01.md`](study-text-performance-v3-luna-evidence-2026-08-01.md)
- [`contextual-speech-annotation-luna-listening-evidence-2026-08-04.md`](contextual-speech-annotation-luna-listening-evidence-2026-08-04.md)
- [`incidents/`](incidents/)

Keep evidence near its procedure when that improves discovery; do not move records solely to make a
uniform folder tree. Supersede a run with a new dated record rather than rewriting its observed result.

Student-owned learner profile migration uses
[student-profile-revision-cutover.md](student-profile-revision-cutover.md), including the preflight
and reconciliation required before removing frozen legacy storage.

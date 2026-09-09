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

Use a current runbook for instructions. Start with the relevant entry in
[`docs/reference/DOCS_IA_MAP.md`](../reference/DOCS_IA_MAP.md), or with the deployment,
backup/restore, health, Telegram, prompt-gallery, or replay runbook named there.

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

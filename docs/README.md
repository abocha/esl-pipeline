# Documentation Router (Agent-First)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 2 minutes.
- Authority Level: Router.
- Last Verified Against: 2026-02-18 repo state.

## Purpose

- Route coding tasks to the smallest authoritative doc set.
- Preserve baseline repo understanding without reading code first.
- Keep active guidance short; keep history in archive.

## When To Read

- Immediately after `AGENTS.md`.
- Any time task scope is unclear.

## Canonical Sources

1. `AGENTS.md` (core bootstrap loaded on agent init).
2. `docs/reference/agents-ssot.md` (authoritative annex, read selectively).
3. `docs/backend-frontend/backend-frontend-alignment.md` (live backend/frontend status).
4. `docs/backend-frontend/BATCH_SYSTEM.md` (active system map).

## Current State

- Active docs are concise playbooks with explicit ownership.
- Detailed historical design and phased manuals are archived.
- Package-level details live in package READMEs.

## Do / Don't

- Do start with this order: `AGENTS.md` -> `docs/README.md` -> task-specific doc.
- Do prefer active docs over archive docs for implementation decisions.
- Don't treat archived docs as current source of truth.
- Don't duplicate status tables across active docs.

## Agent Start Path

- Need one-click restart from repo root: `START_HERE.md`.
- Need a low-friction "restart tomorrow" entrypoint: `docs/playbooks/RESTART_TOMORROW.md`.
- Need canonical Preset V2 architecture/spec: `docs/reference/PRESET_V2_SPEC.md`.
- Need overall repo orientation: `docs/PROJECT_OVERVIEW.md`.
- Need run commands/setup: `docs/QUICK_START.md`.
- Need contracts/invariants: `docs/reference/agents-ssot.md`.
- Need backend/frontend readiness: `docs/backend-frontend/backend-frontend-alignment.md`.
- Need product direction and objective launch gates: `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`.
- Need package-mapped V1 execution checklist: `docs/reference/V1_IMPLEMENTATION_TRACKER.md`.
- Need WS2B provider/model/quota lock details: `docs/reference/GENERATION_PROVIDER_POLICY.md`.
- Need OpenAI Responses API implementation contract for WS2B: `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`.
- Need Google GenAI API implementation contract for WS2B: `docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`.
- Need OpenRouter API implementation contract for WS2B: `docs/reference/OPENROUTER_WS2B_PROFILE.md`.
- Need weekly grounding review cadence: `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`.
- Need student-system implementation roadmap and execution checklist: `docs/reference/STUDENT_SYSTEM_ROADMAP.md`.
- Need Docker mount/permissions troubleshooting: `docs/operations/docker-host-paths.md`.
- Need latest security scan triage and fix log: `docs/reference/SECURITY_SCANS_2026-02-12.md`.
- Need implementation plans and phased execution docs: `docs/plans/README.md`.

## Related

- `docs/reference/DOCS_IA_MAP.md`
- `docs/reference/DOCS_GOVERNANCE.md`
- `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
- `docs/reference/PRESET_V2_SPEC.md`
- `docs/reference/GENERATION_PROVIDER_POLICY.md`
- `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`
- `docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`
- `docs/reference/OPENROUTER_WS2B_PROFILE.md`
- `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`
- `docs/playbooks/RESTART_TOMORROW.md`
- `docs/reference/STUDENT_SYSTEM_ROADMAP.md`
- `docs/reference/SECURITY_SCANS_2026-02-12.md`
- `docs/plans/README.md`
- `docs/archive/README.md`

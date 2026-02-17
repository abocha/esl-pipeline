# Documentation IA Map (Agent Task Router)

## Meta

- Audience: AI agents and maintainers.
- Read Time: 3 minutes.
- Authority Level: Active routing map.
- Last Verified Against: 2026-02-18 repo state.

## Purpose

- Map common coding tasks to the minimum doc set needed for baseline context.

## When To Read

- Right after `docs/README.md`.
- Before opening code for a new task area.

## Canonical Sources

1. `AGENTS.md`
2. `docs/reference/agents-ssot.md`
3. `docs/backend-frontend/backend-frontend-alignment.md`

## Agent Task -> Doc

| Task                                  | Read First                                            | Then Read                                             |
| ------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| Quick reboot from repo root           | `START_HERE.md`                                       | `docs/playbooks/RESTART_TOMORROW.md`                 |
| Repo orientation                      | `docs/PROJECT_OVERVIEW.md`                            | `docs/reference/agents-ssot.md`                       |
| Restarting after context loss         | `docs/playbooks/RESTART_TOMORROW.md`                  | `docs/reference/V1_IMPLEMENTATION_TRACKER.md`         |
| Preset architecture and product model | `docs/reference/PRESET_V2_SPEC.md`                    | `docs/reference/V1_IMPLEMENTATION_TRACKER.md`         |
| Generation provider/model/quota policy | `docs/reference/GENERATION_PROVIDER_POLICY.md`        | `docs/reference/V1_IMPLEMENTATION_TRACKER.md`         |
| OpenAI WS2B API contract profile      | `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`     | `docs/reference/GENERATION_PROVIDER_POLICY.md`        |
| Google WS2B API contract profile      | `docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`         | `docs/reference/GENERATION_PROVIDER_POLICY.md`        |
| OpenRouter WS2B API contract profile  | `docs/reference/OPENROUTER_WS2B_PROFILE.md`           | `docs/reference/GENERATION_PROVIDER_POLICY.md`        |
| Product direction / launch readiness  | `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md` | `docs/backend-frontend/backend-frontend-alignment.md` |
| V1 implementation execution           | `docs/reference/V1_IMPLEMENTATION_TRACKER.md`         | `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`  |
| Weekly product grounding review       | `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`    | `docs/reference/V1_IMPLEMENTATION_TRACKER.md`         |
| Setup/run commands                    | `docs/QUICK_START.md`                                 | `docs/reference/env.md`                               |
| Pipeline contract behavior            | `docs/reference/agents-ssot.md`                       | `docs/reference/pipeline-manifest.md`                 |
| Backend/frontend capability readiness | `docs/backend-frontend/backend-frontend-alignment.md` | `docs/backend-frontend/BATCH_SYSTEM.md`               |
| Transcription flow changes            | `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`          | `docs/PIPELINE_INTEGRATION_VISION.md`                 |
| Student system architecture roadmap   | `docs/reference/STUDENT_SYSTEM_ROADMAP.md`            | `docs/backend-frontend/backend-frontend-alignment.md` |
| Frontend behavior context             | `packages/batch-frontend/README.md`                   | `docs/backend-frontend/BATCH_SYSTEM.md`               |
| Backend behavior context              | `packages/batch-backend/README.md`                    | `docs/backend-frontend/backend-frontend-alignment.md` |

## Current State

- Active docs are concise and status-driven.
- Historical rationale is archive-only.

## Do / Don't

- Do prefer the smallest relevant active doc set.
- Don't jump to archive docs unless current docs are insufficient.

## Related

- `docs/README.md`
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
- `docs/archive/README.md`

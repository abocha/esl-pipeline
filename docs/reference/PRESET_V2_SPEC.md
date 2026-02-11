# Preset V2 Spec (Prompt + Metadata + Output Contract)

## Meta

- Audience: founder, maintainers, AI agents.
- Read Time: 12 minutes.
- Authority Level: canonical preset architecture spec.
- Last Updated: 2026-02-11.

## Purpose

- Define what a learning preset is and what it is not.
- Lock MVP scope so architecture progress is not blocked by full preset authoring.
- Make implementation intent unambiguous for tired humans and AI agents.

## 60-Second Summary

1. Legacy color presets are presentation config, not learning logic.
2. Preset V2 means: prompt + pedagogical metadata + output schema contract.
3. `docs/templates/hw_prompt_v4-2_clean.md` is the canonical baseline prompt for MVP.
4. MVP ships one trusted preset content track: `general-english`.
5. Architecture must support adding more tracks later without rewrites.
6. Direct LLM generation is deferred until preset plumbing MVP is complete.

## Execution Status (Current)

1. WS2A Preset plumbing MVP is complete across contracts/backend/frontend.
2. WS2B Direct LLM generation remains explicitly deferred.
3. MVP scope lock remains unchanged: `general-english` only in this phase.

## WS2A-S1 Locked Decisions

1. Canonical term: `Learning Preset`.
2. Initial storage direction: DB-first entities.
3. Prompt governance policy: immutable snapshots + stable alias.
4. Model strategy: one universal prompt core + runtime scaffolding.
5. Baseline prompt for MVP: `docs/templates/hw_prompt_v4-2_clean.md`.

## Non-Negotiable Constraints

1. Managed SaaS model remains centralized (no user-provided API keys).
2. MVP content breadth is intentionally narrow.
3. Preset architecture must support future tracks:
   - IELTS
   - Teens
   - CEFR-rich variants
4. Pedagogic authoring will proceed in parallel with technical plumbing.

## Terminology

## Legacy Color Preset

- Current meaning in orchestrator config (`packages/orchestrator/configs/presets.json`).
- Purpose: heading colors/rendering behavior.
- Not a pedagogical preset.

## Learning Preset (Preset V2)

- New product entity used for assignment generation behavior.
- Includes prompt strategy, pedagogic metadata, and output contract.

## Prompt Workspace

- Workspace for storing/editing/versioning learning presets.
- Sits alongside Student Workspace.

## Student Workspace

- Learner context and operations.
- Consumes preset outputs but does not define preset content.

## Canonical Baseline Prompt (MVP)

- Baseline prompt file: `docs/templates/hw_prompt_v4-2_clean.md`
- Scope in this phase: `general-english` assignments.
- Rationale:
  - validated over long-term real student usage,
  - known reliable behavior with current frontier model workflows,
  - best available starting point before weaker-model hardening.

## Preset V2 Model (Conceptual Contract)

MVP must treat this as the source model:

```ts
type PresetTrack = 'general-english' | 'ielts' | 'teens' | 'custom';
type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

interface LearningPresetV2 {
  id: string;                  // stable key
  version: string;             // semantic or date-based version
  alias?: string;              // stable pointer label, e.g. "current"
  track: PresetTrack;          // MVP content: general-english only
  title: string;               // human-friendly label
  status: 'draft' | 'active' | 'deprecated';
  promptTemplate: string;      // generation prompt body or template ref
  promptVariables: string[];   // variables expected by template
  cefrSupport?: CefrLevel[];   // plumbing-ready even if content-limited in MVP
  defaultCefr?: CefrLevel;
  outputSchema: AssignmentOutputSchemaV2;
  qualityNotes?: string;       // pedagogic guidance
  author: string;
  updatedAt: string;
}

interface AssignmentOutputSchemaV2 {
  requiredSections: string[];  // e.g. warmup, vocab, grammar, speaking, homework
  optionalSections?: string[];
  validationHints?: string[];  // content quality constraints
}
```

## Persistence Direction (Locked for WS2A-S1)

- Initial persistence direction is DB-first entities.
- File templates remain reference assets and baseline artifacts.
- Implementation details (tables/repos/migrations) are handled in WS2A-S2+.

## Prompt Versioning and Alias Policy (Locked)

Use both:

1. Immutable snapshots
   - examples:
     - `hw_prompt_v4-2_clean.md`
     - `hw_prompt_v4-3_clean.md`
   - snapshots are never overwritten once activated.
2. Stable alias
   - one active pointer concept (e.g., `current`) maps to a snapshot version.
   - promotion means switching alias target, not mutating historical snapshot files.

Required release metadata per promotion:

1. prompt version id,
2. change summary,
3. expected effect,
4. rollback condition,
5. activation date.

## MVP Scope Lock (Current Phase)

1. Ship one preset content track only: `general-english`.
2. Build full plumbing for:
   - versioning,
   - schema contract,
   - future track extensibility,
   - CEFR-compatible metadata fields.
3. Do not block architecture on building full CEFR/IELTS/teens preset catalogs.

## Universal Prompt + Runtime Scaffolding Strategy (Locked)

- WS2A/WS2B strategy is a single universal prompt core, not model-tier prompt forks.
- Reliability for weaker models should be improved through runtime scaffolding layers:
  - schema-aware validation,
  - structural post-checks,
  - retry/repair loops,
  - explicit context packaging.
- Prompt forking by model tier is deferred unless runtime evidence proves universal strategy is insufficient.

## Explicitly Out of Scope for This MVP Slice

1. Full CEFR preset catalog authoring.
2. Community preset store.
3. Multi-track pedagogic curation at scale.
4. Marketplace/distribution mechanics.

## Prompt Workspace Requirements (MVP)

1. Can list existing presets with version/status.
2. Can inspect preset metadata and output schema contract.
3. Can edit draft preset safely.
4. Can activate/deprecate versions explicitly.
5. Can preview generated draft using internal HTML preview path before publish.

## Assignment Output Contract Requirements

1. Every generated draft declares:
   - learning preset id,
   - learning preset version,
   - prompt snapshot version (and alias if applicable).
2. Generated draft can be validated against preset output schema.
3. Validation failures are surfaced before publish.
4. Preview step is available before publish approval.

## Preview Requirement (Locked)

- Draft preview should use the internal HTML preview renderer path already used in publishing flows.
- Preview is part of assignment quality control, not a cosmetic add-on.

## Runtime Flow (Target)

1. Tutor chooses student context.
2. Tutor chooses learning preset version (MVP default: general-english active).
3. Draft is generated/assembled with preset template + metadata.
4. Draft is validated against preset output schema.
5. Draft is previewed in HTML renderer.
6. Draft is published.

## WS2 Split Decision (Locked)

1. `WS2A`: Preset plumbing MVP (complete).
2. `WS2B`: Direct LLM generation (deferred).

Gate:

- WS2B cannot start until WS2A acceptance criteria are met and WS2B start-gate items in the tracker are checked.

## Acceptance Criteria (Preset Plumbing MVP)

1. Learning preset model is documented and routed as canonical.
2. Tracker workflow is aligned to WS2A-first execution.
3. MVP scope lock is explicit: general-english content only.
4. Prompt Workspace and preview requirements are defined enough to implement without re-deciding architecture.
5. WS2B defer gate is explicit in tracker and restart docs.

## Risks and Mitigations

1. Risk: architecture drifts back to legacy color preset semantics.
   Mitigation: keep terminology section and scope lock explicit in all execution docs.
2. Risk: pedagogic authoring blocks engineering progress.
   Mitigation: single trusted MVP preset content + extensible plumbing first.
3. Risk: future expansion causes rewrites.
   Mitigation: versioned preset model and output schema contract now.

## Research Backlog (Post-WS2A-S1)

1. Schema-Guided Reasoning for weaker models:
   - define what it means in this pipeline,
   - test whether schema-conditioned planning improves structure adherence.
2. Scaffolding effectiveness benchmarks:
   - compare universal prompt + scaffolding vs prompt forks by model tier.
3. Failure taxonomy:
   - classify weak-model errors by section/schema violation type.

## Related

- `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
- `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- `docs/playbooks/RESTART_TOMORROW.md`
- `START_HERE.md`

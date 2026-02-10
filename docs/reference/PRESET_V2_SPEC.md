# Preset V2 Spec (Prompt + Metadata + Output Contract)

## Meta

- Audience: founder, maintainers, AI agents.
- Read Time: 12 minutes.
- Authority Level: canonical preset architecture spec.
- Last Updated: 2026-02-10.

## Purpose

- Define what a learning preset is and what it is not.
- Lock MVP scope so architecture progress is not blocked by full preset authoring.
- Make implementation intent unambiguous for tired humans and AI agents.

## 60-Second Summary

1. Legacy color presets are presentation config, not learning logic.
2. Preset V2 means: prompt + pedagogical metadata + output schema contract.
3. MVP ships one trusted preset content track: `general-english`.
4. Architecture must support adding more tracks later without rewrites.
5. Direct LLM generation is deferred until preset plumbing MVP is complete.

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

## Preset V2 Model (Conceptual Contract)

MVP must treat this as the source model:

```ts
type PresetTrack = 'general-english' | 'ielts' | 'teens' | 'custom';
type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

interface LearningPresetV2 {
  id: string;                  // stable key
  version: string;             // semantic or date-based version
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

## MVP Scope Lock (Current Phase)

1. Ship one preset content track only: `general-english`.
2. Build full plumbing for:
   - versioning,
   - schema contract,
   - future track extensibility,
   - CEFR-compatible metadata fields.
3. Do not block architecture on building full CEFR/IELTS/teens preset catalogs.

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

1. Every generated draft declares which preset version was used.
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

1. `WS2A`: Preset plumbing MVP (active now).
2. `WS2B`: Direct LLM generation (deferred until WS2A complete).

Gate:

- WS2B cannot start until WS2A acceptance criteria are met.

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

## Related

- `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
- `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- `docs/playbooks/RESTART_TOMORROW.md`
- `START_HERE.md`

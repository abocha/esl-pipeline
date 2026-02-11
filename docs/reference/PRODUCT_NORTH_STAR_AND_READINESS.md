# Product North Star and Readiness Scaffold (Private SaaS)

## Meta

- Audience: Founder, maintainers, product and engineering collaborators.
- Read Time: 10 minutes.
- Authority Level: Product direction and readiness scaffold.
- Last Verified Against: 2026-02-10 repo strategy.

## Purpose

- Keep this project grounded in business reality.
- Prevent drift into "interesting engineering" that does not help tutors.
- Define objective readiness gates before broader launch.

## Non-Negotiable Context

- This product is intended to be a managed SaaS, not self-host software.
- Target users (solo ESL tutors) are mostly non-technical.
- V1 should be generalized and normalized first; deep tutor customization comes later.
- Architecture must support future customization additively, without rewrites.
- Third-party API keys and provider management remain centralized in the service.

## North Star

> A solo ESL tutor can create and publish a useful homework assignment in under 12 minutes, without technical setup, and can reliably track lesson-package balance for each student.

## Product Success Definition

The product is successful when it consistently does all three:

1. Saves tutor time every week.
2. Improves tutor operational clarity (who has paid, who has lessons left).
3. Feels reliable and simple enough that non-technical tutors can keep using it.

## V1 Product Scope (Generalized First)

### In Scope

- End-to-end assignment flow in one guided UX:
  - upload/recording -> transcript -> draft -> validate -> publish.
- Preset plumbing MVP:
  - learning preset model (`prompt + metadata + output contract`),
  - Prompt Workspace foundations,
  - one trusted shipped preset content track: `general-english`,
  - canonical baseline prompt: `docs/templates/hw_prompt_v4-2_clean.md`.
- Direct LLM generation through backend API (deferred until preset plumbing MVP passes acceptance criteria).
- At least one low-cost TTS fallback in addition to premium providers.
- Basic CRM-lite ledger:
  - student package purchase tracking,
  - lesson consumption tracking,
  - remaining paid lessons dashboard.

### Out of Scope (V1)

- Full accounting/tax engine.
- Complex invoice automation.
- Tutor-facing advanced customization studio.
- Broad marketplace-like feature set.

## Anti-Rewrite Plumbing Required Early

These seams must exist before aggressive feature expansion:

1. Generation provider abstraction (`GenerationProvider`).
2. Speech provider abstraction (`SpeechProvider`).
3. Cost policy layer (quotas, per-tutor limits, budget hard stops).
4. Billing/lesson ledger domain (packages, consumption events, payment records).
5. Preset model versioning and prompt governance (so learning presets can evolve safely).

Suggested package ownership:

- Contracts and DTOs: `packages/contracts`
- Provider orchestration and policy: `packages/batch-backend`
- Pipeline integration points: `packages/orchestrator`, `packages/tts-elevenlabs`
- Tutor UX and dashboard: `packages/batch-frontend`

## 8-Week Execution Roadmap

### Weeks 1-2: Preset Foundation + Provider Seams

- Implement Preset V2 plumbing:
  - learning preset model,
  - Prompt Workspace baseline,
  - normalized assignment output schema contract,
  - immutable prompt snapshot + stable alias governance.
- Ship one trusted content track: `general-english`.
- Keep existing flow stable; no broad UX expansion yet.

Exit criteria:

- `general-english` preset works end-to-end with schema-aware flow.
- System can add more presets/tracks without rewrites.

### Weeks 3-4: Preset Plumbing Completion + Preview

- Add Prompt Workspace editing/versioning workflow for learning presets.
- Add draft preview requirement in assignment workflow using internal HTML preview renderer path.
- Validate preset output against schema contract before publish.
- Lock universal prompt + runtime scaffolding strategy for weaker-model resilience.

Exit criteria:

- Tutor can reliably run preset-driven assignment flow with preview and validation.
- Preset version provenance is captured in assignment flow.
- Baseline prompt governance (snapshot + alias) is operationally documented.

### Weeks 5-6: Direct LLM Generation (Post-Plumbing)

- Add backend generation endpoint and service path.
- Connect frontend flow to generated drafts directly.
- Preserve manual fallback for operational safety.

Exit criteria:

- Tutor can generate draft from UI without copy-paste.
- Generation uses Preset V2 contracts and versioned preset context.

### Weeks 7-8: Low-Cost TTS Path + Spend Controls

- Integrate at least one low-cost/free-viable TTS provider path.
- Add monthly and per-request limits with visible UX feedback.
- Expose provider mode in internal telemetry.

Exit criteria:

- Audio generation works without premium-only dependency.
- Budget controls prevent unexpected provider spend spikes.

### Weeks 9-10: CRM-lite Ledger and Tutor Dashboard

- Add lesson package purchase records.
- Add lesson consumption events tied to delivered lessons.
- Add student-level "remaining lessons" dashboard views.

Exit criteria:

- Tutor can answer "who has lessons left?" in seconds.
- Remaining lesson calculations are consistent and test-covered.

## Objective Readiness Scorecard (Grounding Scaffold)

Track weekly. Do not rely on intuition alone.

### 1) Product Utility

- Median time to first published assignment.
  - Green: <= 12 min
  - Yellow: 12-20 min
  - Red: > 20 min
- Percent of assignments completed without manual fallback.
  - Green: >= 80%
  - Yellow: 60-79%
  - Red: < 60%

### 2) Reliability

- End-to-end assignment success rate.
  - Green: >= 97%
  - Yellow: 93-96.9%
  - Red: < 93%
- Failed run recovery success (rerun/resume path).
  - Green: >= 90%
  - Yellow: 75-89%
  - Red: < 75%

### 3) Usability (Non-Technical Tutor Fit)

- New tutor first-session success (publishes at least one assignment).
  - Green: >= 80%
  - Yellow: 60-79%
  - Red: < 60%
- Support burden (manual interventions per active tutor per week).
  - Green: <= 0.3
  - Yellow: 0.31-0.7
  - Red: > 0.7

### 4) Business Viability

- Weekly active tutors retained for 4+ weeks.
  - Green: >= 60%
  - Yellow: 40-59%
  - Red: < 40%
- Tutor-reported weekly time saved.
  - Green: >= 2.0 hours
  - Yellow: 1.0-1.9 hours
  - Red: < 1.0 hour

## Evidence Rules (Anti-Delusion Guardrails)

- "Demand exists" is only valid if real tutors repeatedly use the product, not just praise demos.
- "Ready to broaden beta" requires scorecard mostly green for at least 2 consecutive weeks.
- "Ready for paid plans" requires:
  - stable reliability,
  - clear weekly value delivered,
  - acceptable support load.
- New major features should be paused if reliability or first-session success drops into red.

## Weekly Operating Rhythm

Every week:

1. Update the scorecard metrics.
2. Review the top 3 tutor pain points from calls/messages.
3. Pick one reliability fix, one usability fix, one value improvement.
4. Confirm roadmap phase priorities still match tutor evidence.
5. Record decisions and rejected ideas with reasons.

## Stage Gates

### Gate A: Founder-Operator Stability

- You can run the flow repeatedly with low failure and no setup surprises.

### Gate B: Concierge Alpha (3-5 Tutors)

- Most tutors can complete the core flow with minimal hand-holding.

### Gate C: Closed Beta (10-30 Tutors)

- Reliability, support load, and time-saved metrics sustain at acceptable levels.

### Gate D: Paid Launch Readiness

- Product utility and business viability metrics are consistently green.

## Related

- `docs/backend-frontend/backend-frontend-alignment.md`
- `docs/reference/PRESET_V2_SPEC.md`
- `docs/reference/STUDENT_SYSTEM_ROADMAP.md`
- `packages/orchestrator/README.md`
- `packages/batch-backend/README.md`
- `packages/batch-frontend/README.md`

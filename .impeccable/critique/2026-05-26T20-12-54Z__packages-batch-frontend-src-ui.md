---
target: packages/batch-frontend/src/ui
total_score: 24
p0_count: 0
p1_count: 3
timestamp: 2026-05-26T20-12-54Z
slug: packages-batch-frontend-src-ui
---

#### Design Health Score

| #         | Heuristic                       | Score     | Key Issue                                                                                                                                                      |
| --------- | ------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     | 3         | Strong staged workflow, busy, preview, and route states; runtime/job status still leaks into teacher-facing areas.                                             |
| 2         | Match System / Real World       | 2         | The app still says `Prompt Templates`, `canonical pedagogical truth`, `memory signals`, `lineage`, `provenance`, and revision IDs in places teachers must use. |
| 3         | User Control and Freedom        | 3         | Resume, restore, cancel, preview, and dirty-state protections exist; advanced controls still ask users to choose between similarly risky actions.              |
| 4         | Consistency and Standards       | 2         | Button language, panel vocabulary, typography, badges, and action grouping vary across Assignments, Students, Business, and Prompts.                           |
| 5         | Error Prevention                | 3         | Disabled states, preview-before-share, destructive confirmations, and guarded generated flows are solid.                                                       |
| 6         | Recognition Rather Than Recall  | 2         | Main actions are visible, but users must understand internal concepts to choose safely in learning, prompt, and lineage areas.                                 |
| 7         | Flexibility and Efficiency      | 2         | Power features exist, but they appear as exposed machinery rather than streamlined expert workflows or bulk/keyboard accelerators.                             |
| 8         | Aesthetic and Minimalist Design | 2         | Too many framed panels, cards, gradients, badges, serif headings, and decorative shells for task-first product UI.                                             |
| 9         | Error Recovery                  | 2         | Errors are surfaced, but recovery copy often remains raw or operational rather than user-oriented.                                                             |
| 10        | Help and Documentation          | 3         | Inline help is abundant and often useful, but it frequently adds reading load instead of making the next action obvious.                                       |
| **Total** |                                 | **24/40** | **Acceptable, significant improvements still needed before the UI feels settled.**                                                                             |

#### Anti-Patterns Verdict

**LLM assessment**: This is not obvious low-effort generated UI. The staged assignment builder is thoughtful, authenticated routes render, and the app has real workflow care. The slop tells are subtler: product theater styling, repeated framed panel composition, display/serif typography inside operational surfaces, and system vocabulary exposed as product language.

The current full picture is better than the earlier pre-merge state because the v7.0.1 live app now includes the repaired auth/focus/theme/card cleanup work. The biggest remaining problem is not whether the app works. It is whether the app feels like a calm teaching operations tool instead of a teacher flow wrapped around maintainer diagnostics.

**Deterministic scan**: The local `$impeccable` detector wrapper initially failed because the bundled detector was absent. I patched the local skill wrapper to fall back to the installed global npm `impeccable` package. After that, `node C:\Users\abocha\.agents\skills\impeccable\scripts\detect.mjs --json --fast packages/batch-frontend/src/ui` ran and reported one finding:

- `layout-transition`, warning, [SharedControls.css](D:/code/esl-pipeline/packages/batch-frontend/src/ui/shared/SharedControls.css:112): `transition: width` on `.upload-progress-bar span`, imported by `DropZone.tsx` and `UploadProgress.tsx`.

This is a real technical polish issue, not a major UX blocker. Progress width animation can cause layout work; use a transform-based fill or CSS grid/scale strategy instead.

**Visual overlays**: No reliable user-visible overlay is available. Browser inspection worked for route evidence, but mutation preflight failed: setting `document.title` is blocked by the read-only Browser evaluate surface. I did not start the live overlay server and I am not claiming a `[Human]` overlay exists.

#### Overall Impression

The app now has a credible product spine: the assignment builder guides the primary work, student routes exist, and sampled authenticated routes have no unlabeled buttons or horizontal overflow at the default Browser viewport. The single biggest opportunity is to separate teacher-facing workflows from operator/diagnostic machinery. The UI keeps asking teachers to understand the system that powers the product.

#### What's Working

- The assignment builder has a real guided structure: `Resume or start`, staged lock/unlock states, preview before sharing, and advanced actions that at least wait until the user has a shared assignment.
- The student overview route is materially stronger than the old all-in-one workspace model: it gives learning state, operations, snapshot, focus, and recent activity without requiring immediate editing.
- Accessibility basics are better than before: sampled live routes had zero unlabeled buttons and no horizontal overflow at the default Browser viewport.

#### Priority Issues

1. **[P1] Internal IA leaks into teacher-facing labels**
   - **Why it matters**: A teacher trying to prepare or review a lesson has to translate `Prompt Templates`, `canonical pedagogical truth`, `memory signals`, `assignment lineage`, `profile truth`, and `provenance` into teaching concepts.
   - **Fix**: Rename primary concepts around the teacher job: assignment templates, learner context, teaching memory, lesson history, support details. Keep lineage/provenance inside diagnostics.
   - **Suggested command**: `impeccable clarify`

2. **[P1] Advanced assignment and student-learning controls compete with the main mental model**
   - **Why it matters**: Republish, rerun audio, provider/model fields, quotas, revision controls, provenance, and UUIDs are useful, but they shift the user from lesson preparation into system operation.
   - **Fix**: Introduce a real diagnostics/operator mode or drawer. Keep teacher-facing surfaces focused on upload, context, generate, review, share, and learner profile edits.
   - **Suggested command**: `impeccable distill`

3. **[P1] Product UI still carries editorial/brand styling**
   - **Why it matters**: The authenticated app uses radial gradients, serif headings/metrics, glow accents, soft illustration-like avatar treatments, and card-heavy composition. That makes a durable operations surface feel ornamental.
   - **Fix**: Remove serif/display typography from authenticated labels/data, reduce decorative gradients, and reserve visual warmth for empty states or onboarding rather than every panel.
   - **Suggested command**: `impeccable quieter`

4. **[P2] Component vocabulary is still fragmented across surfaces**
   - **Why it matters**: Assignments, Prompts, Business, and Students use different panel/card/button/status idioms. Users learn one surface, then lose that learning on the next.
   - **Fix**: Extract one product component system for panels, status pills, button hierarchy, section headers, action rows, and metric summaries.
   - **Suggested command**: `impeccable extract`

5. **[P2] One detector finding remains in shared upload controls**
   - **Why it matters**: `transition: width` on upload progress can cause unnecessary layout work and is explicitly flagged by the detector.
   - **Fix**: Animate a transform, for example `scaleX`, with a fixed-width fill layer and `transform-origin: left`.
   - **Suggested command**: `impeccable polish`

#### Persona Red Flags

**Alex (Power User)**: Alex can probably complete the main assignment path, but the app slows them with visible stage prose, revision controls, provider/quota details, and repeated restore/activate actions. They will want a fast mode: recent assignment, upload, generate, preview, share.

**Jordan (First-Timer)**: Jordan benefits from the staged assignment builder, then stumbles on `Prompt Templates`, `canonical pedagogical truth`, `memory snapshot`, `revision controls`, and `provenance`. These labels make them wonder if they are editing lesson content or database state.

**Sam (Accessibility-Dependent User)**: Route-level labels look better: sampled buttons were labeled and skip links exist. Remaining risk is cognitive and structural: long panel stacks, color-heavy status chips, abbreviation icons like `CAL`, `CR`, `MSG`, `INV`, and dense history/provenance timelines.

#### Minor Observations

- `Student ID` appears prominently on teacher-facing student pages. It is useful for support, but noisy for daily teaching.
- The Business schedule route is functional and dense, but repeated `Complete`, `No-show`, `Cancel` clusters would benefit from a row action hierarchy.
- `Prompt Templates` has 32 buttons on the sampled route, mostly revision restore/activate pairs. That is a support/admin surface trying to live as primary nav.
- Assessment B's subagent result is now outdated because it ran before the detector-wrapper repair. The parent-verified detector run should be treated as current.

#### Questions to Consider

1. Which vocabulary direction should lead the next pass?
   - **Teacher-first**: rename prompts, lineage, memory, and revisions into teaching concepts.
   - **Operator-first**: keep technical names, but move the surface under admin/support.
   - **Hybrid**: teacher labels by default, technical details inside diagnostics.

2. Which UI cleanup should be first?
   - **Typography and styling**: remove serif/display and decorative gradients from authenticated product surfaces.
   - **IA and disclosure**: split teacher workflow from diagnostics/operator controls.
   - **Component extraction**: unify buttons, panels, pills, and action rows first.

3. How aggressive should the next implementation be?
   - **Top 2 P1s only**: language plus diagnostics separation.
   - **All P1s**: language, diagnostics, and product styling.
   - **Full pass**: P1s plus component extraction and detector polish.

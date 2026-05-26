---
target: packages/batch-frontend/src/ui
total_score: 26
p0_count: 0
p1_count: 2
timestamp: 2026-05-26T19-37-03Z
slug: packages-batch-frontend-src-ui
---
**Overall Impression**

The frontend repair is a real improvement: auth is more semantic, the most generic glass/card language was reduced, the assignment flow lazy-loads cleanly, and live route checks on `http://localhost:5173/`, `/students`, and `/prompts` show authenticated content rendering with no sampled horizontal overflow or unlabeled buttons at the default Browser viewport.

The remaining issue is not polish by itself. The product still carries two mental models: a quieter routed teacher/operator tool, and an older all-in-one workspace/workbench model. That makes the UI feel more technically composed than task-native in the places where teachers need confidence and operators need predictable action language.

**Design Health Score**

| # | Heuristic | Score | Notes |
|---|---:|---:|---|
| 1 | Visibility of system status | 3 | Loading, dirty, empty, and route status affordances are visible; old dense panels still bury state changes. |
| 2 | Match with real world | 3 | Teacher language improved; internal terms like prompt package, lineage, binding, and revision controls still leak. |
| 3 | User control and freedom | 3 | Confirm/cancel/restore patterns exist; destructive and revision actions still crowd together. |
| 4 | Consistency and standards | 2 | Save/create/archive/restore/action vocabulary varies across prompt and student surfaces. |
| 5 | Error prevention | 3 | Disabled states and scoped labels help; advanced template/revision actions need stronger hierarchy. |
| 6 | Recognition over recall | 3 | Navigation and table labels improved; long workflows still ask users to remember too much context. |
| 7 | Flexibility and efficiency | 2 | Dense workflows exist, but power-user paths lack clear command structure and predictable bulk/keyboard patterns. |
| 8 | Aesthetic and minimalist design | 2 | Generic card/glass cleanup helped; framed panels, serif data treatments, and decorative shell gradients remain. |
| 9 | Error recovery | 3 | Errors and recovery states exist; recovery priority and copy are uneven across high-stakes actions. |
| 10 | Help and documentation | 2 | Inline help exists in spots, but high-stakes actions do not have a consistent contextual help layer. |
| **Total** |  | **26/40** | **Improved but still heavier than the product task model wants.** |

**Anti-Pattern Verdict**

This no longer reads as obvious generic generated UI. The repair removed meaningful signals: raw `.card`/glass classes, dark theme drift, missing auth focus semantics, and some duplicated table markup. The residue is subtler: panel-heavy composition, over-systemized action language, and editorial typography in operational data views.

**What Works**

- The auth dialog has much stronger modal semantics, focus behavior, and alert treatment.
- `MinimalAssignment` being lazy-loaded is the right architectural move for the home assignment workflow.
- The shared workspace assignment history table is a cleaner, more accessible replacement for duplicated markup.
- Live Browser checks on `/`, `/students`, and `/prompts` found no unlabeled buttons and no horizontal overflow at the default in-app viewport.

**Priority Issues**

1. **P1: Legacy workspace keeps the old mental model alive.** `StudentWorkspace.tsx`, `WorkspaceCandidatesPanel.tsx`, `WorkspaceHistoryPanel.tsx`, and `WorkspaceInspectionPanel.tsx` still use `workspace-card workspace-panel` and present an all-in-one operator surface. If this is test/legacy-only, name and isolate it that way; if it is product, split it into the same routed task model as the active student area.

2. **P1: Action language is not yet a system.** Prompt templates use `Save Template`, `Restore v13`, and `Activate v13`; legacy/student surfaces still contain `Save Template Content`, bare `Restore`, bare `Activate`, and other variants. Define one lexicon for `Create`, `Save`, `Archive`, `Restore revision`, `Activate revision`, and apply it everywhere.

3. **P2: Framed panels replaced generic cards without changing the composition enough.** The raw `.card` smell is reduced, but `workspace-panel`, `student-area-panel`, `minimal-*-card`, and `student-learning-*-card` still make many surfaces read as stacked framed boxes. Keep cards for repeated entities and modals; move long workflows toward unframed bands, forms, and tables.

4. **P2: Serif/display typography is still leaking into operational data.** `PromptTemplatesPage.css`, `BusinessDashboard.css`, `StudentAreaShell.css`, `StudentHistoryPage.css`, and `StudentOverviewPage.css` still use `var(--app-serif)` or Georgia-like treatments in headings, metrics, status prose, and event cards. For this product register, data and controls should stay in the product sans.

5. **P2: Live responsive evidence is incomplete.** The in-app Browser route checks were useful, but the viewport override did not take during this run. The previous audit recorded responsive checks, but this critique should treat current mobile/tablet visual proof as a remaining gap.

**Persona Notes**

- **Teacher/operator:** Can get through the main assignment and student routes, but revision/template controls still create fear of choosing the wrong action.
- **First-time teacher:** The routed student area is clearer than the legacy workspace, but terms like `Prompt Templates`, `lineage`, `binding`, and `revision controls` need task framing.
- **Power user:** Dense controls are present, but inconsistent action labels slow muscle memory.
- **Accessibility-sensitive user:** Sampled routes have labeled buttons and no default overflow, but the remaining long panel stacks and incomplete responsive check leave tab-order and mobile confidence only partially proven.

**Minor Observations**

- `ThemeContext` now honestly constrains the app to light mode, but public no-op `toggleTheme`/`setTheme` APIs are a future footgun.
- Auth still uses the primary gradient treatment; acceptable as a modal accent, but it is one of the remaining decorative signals.
- The draft audit is useful and candid, but it mixes implementation evidence and product guidance; keep it draft-scoped unless promoted into a shorter current-status doc.

**Questions For The Next Pass**

1. Should `StudentWorkspace` be fully retired from product navigation, or preserved as an explicit dev/test harness?
2. Should prompt/template actions be optimized for teachers or for operators/admins first?
3. Is the desired student-area visual direction a dense operations tool, or a warmer teacher workspace with only local density where it helps?

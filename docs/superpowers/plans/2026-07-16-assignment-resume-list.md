# Assignment Resume List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unbounded Step 1 resume rows with four compact assignment lineages, contract-backed recovery anchors, aligned state rails, expandable rerun version history, and progressive older-assignment loading.

**Architecture:** Keep raw collection loading in `useMinimalAssignmentResume`, extend the existing resume presentation module to build recovery-aware items and proven `sourceJobId` lineages, and let `AssignmentEntryStep` own purely local visibility and expansion state. Reuse existing job/session endpoints and native radio selection; add no DTO, backend, database, or dependency change.

**Tech Stack:** React 19, TypeScript 6, Vitest, Testing Library, lucide-react, existing Calm Studio CSS tokens.

## Global Constraints

- Show four assignment lineages initially and append up to eight more per explicit disclosure action.
- A rerun lineage consumes one visible slot; group jobs only through loaded `sourceJobId` links.
- Keep learner identity, recovery anchor, and state/time in distinct columns.
- Use the approved fixed state rail and version-count disclosure pill from `docs/superpowers/specs/assets/assignment-resume-list-reference.png`.
- Keep native radio selection for the latest and every older version.
- Keep `Latest rerun` as plain text and place `N versions` plus chevron in a separate pill button.
- Keep the history thread free of decorative node circles; the native radio is the only circle in each version row.
- Do not add search, filters, numbered pagination, nested scrolling, a modal, or a history route.
- Do not fetch or synthesize lesson titles in this slice.
- Preserve current Resume/New mutual exclusion, hydration destinations, URL behavior, and status-specific primary actions.
- Preserve WCAG AA contrast, keyboard access, reduced-motion behavior, and 44px interactive targets.

---

## File Structure

- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.ts`
  - extend the recent-item presentation contract and define assignment-lineage output
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.ts`
  - derive recovery anchors and collapse flat session/job items into proven lineages
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.test.ts`
  - cover anchor mapping, sorting, missing parents, and chained reruns
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts`
  - track collection totals and load additional jobs/sessions through existing APIs
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx`
  - verify incremental collection loading, merging, exhaustion, retry, and selection preservation
- `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
  - pass lineages and incremental-loading state into Step 1
- `packages/batch-frontend/src/ui/assignments/steps/AssignmentEntryStep.tsx`
  - render lineage rows, version disclosure, exact-version radios, and local progressive visibility
- `packages/batch-frontend/src/ui/assignments/steps/AssignmentEntryStep.test.tsx`
  - cover initial four, load-more behavior, expansion, precise selection, and accessible pill states
- `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.css`
  - implement the approved desktop, history, hover/focus, and narrow layouts
- `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.responsive.test.tsx`
  - assert required layout, focus, pill, and reduced-motion contracts
- `packages/batch-frontend/README.md`
  - keep the package workflow summary aligned with the new resume-list behavior
- `docs/backend-frontend/backend-frontend-alignment.md`
  - update the live assignment-builder description without changing backend capability claims

---

### Task 1: Recovery-aware item and lineage presentation

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.ts`
- Test: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.test.ts`

**Interfaces:**

- Consumes: `AssignmentSession[]`, `JobStatus[]`, selected item ID, and learner-name map
- Produces: `RecentAssignmentItem.recoveryAnchor`, `RecentAssignmentItem.sourceJobId`, `RecentAssignmentItem.kind`, `RecentAssignmentLineage`, and `buildRecentAssignmentLineages(items)`

- [ ] **Step 1: Write failing tests for recovery anchors and lineage grouping**

Add tests that assert all session stages, all job artifact combinations, a direct rerun, a rerun-of-rerun chain, similar unlinked jobs, and a rerun with a missing parent:

```ts
expect(
  buildRecentAssignmentItems([createSession({ currentStage: 'context' })], [], '', names)[0],
).toMatchObject({ kind: 'session', recoveryAnchor: 'Step 3 · Teaching context' });

expect(
  buildRecentAssignmentItems(
    [],
    [createJob({ promptPackageId: 'prompt-1', draftId: 'draft-1' })],
    '',
    names,
  )[0],
).toMatchObject({ kind: 'job', recoveryAnchor: 'Guidance & assignment draft' });

const lineages = buildRecentAssignmentLineages([
  createPresentedJob({ id: 'job-3', sourceJobId: 'job-2' }),
  createPresentedJob({ id: 'job-2', sourceJobId: 'job-1' }),
  createPresentedJob({ id: 'job-1', sourceJobId: null }),
]);
expect(lineages).toHaveLength(1);
expect(lineages[0].latest.id).toBe('job-3');
expect(lineages[0].olderVersions.map((item) => item.id)).toEqual(['job-2', 'job-1']);
```

- [ ] **Step 2: Run the focused test and verify the new contract fails**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.resume-presentation.test.ts --testTimeout=15000
```

Expected: FAIL because `recoveryAnchor`, `kind`, `sourceJobId`, `RecentAssignmentLineage`, and `buildRecentAssignmentLineages` do not exist.

- [ ] **Step 3: Extend the presentation types**

Add the focused fields and lineage type:

```ts
export interface RecentAssignmentItem {
  id: string;
  kind: 'session' | 'job';
  sourceJobId: string | null;
  learnerName: string;
  lessonTitle?: string;
  recoveryAnchor: string | null;
  activityLabel: string;
  outcomeLabel: string;
  timeLabel: string;
  state: RecentAssignmentState;
  statusLabel: string;
  statusTone: 'success' | 'progress' | 'warning' | 'neutral';
  actionLabel:
    | 'Continue assignment'
    | 'Review progress'
    | 'Review assignment'
    | 'Open assignment'
    | 'Review issue';
  destination: AssignmentStepId;
  selected: boolean;
}

export interface RecentAssignmentLineage {
  id: string;
  latest: RecentAssignmentItem;
  olderVersions: RecentAssignmentItem[];
}
```

- [ ] **Step 4: Implement recovery-anchor derivation and proven lineage grouping**

Use explicit helpers and loaded-parent traversal:

```ts
const SESSION_RECOVERY_ANCHORS: Record<AssignmentSessionStage, string> = {
  source: 'Step 2 · Lesson source',
  context: 'Step 3 · Teaching context',
  assignment: 'Step 4 · Create',
  review: 'Step 5 · Review & share',
};

function getJobRecoveryAnchor(job: JobStatus): string | null {
  if (job.promptPackageId && job.draftId) return 'Guidance & assignment draft';
  if (job.draftId) return 'Assignment draft';
  if (job.promptPackageId) return 'Lesson guidance';
  if (job.transcriptId || job.recordingId) return 'Lesson source';
  return null;
}

export function buildRecentAssignmentLineages(
  items: readonly RecentAssignmentItem[],
): RecentAssignmentLineage[] {
  const jobsById = new Map(
    items.filter((item) => item.kind === 'job').map((item) => [item.id, item]),
  );
  const groups = new Map<string, RecentAssignmentItem[]>();

  for (const item of items) {
    let key = item.id;
    if (item.kind === 'job') {
      const visited = new Set<string>([item.id]);
      let cursor = item;
      while (
        cursor.sourceJobId &&
        jobsById.has(cursor.sourceJobId) &&
        !visited.has(cursor.sourceJobId)
      ) {
        key = cursor.sourceJobId;
        visited.add(cursor.sourceJobId);
        cursor = jobsById.get(cursor.sourceJobId)!;
      }
    }
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.values()].map(([latest, ...olderVersions]) => ({
    id: latest.id,
    latest,
    olderVersions,
  }));
}
```

Preserve the existing newest-first flat-item sort before grouping so each group and the group list remain newest-first.

- [ ] **Step 5: Run the focused test and verify it passes**

Run the command from Step 2.

Expected: PASS for item sorting, anchor mapping, selection, missing-parent safety, unlinked-job separation, and chained lineage grouping.

- [ ] **Step 6: Commit the presentation model**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.entry-state.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-presentation.test.ts
git commit -m "feat(batch-frontend): model assignment resume lineages"
```

---

### Task 2: Incremental resume collection loading

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts`
- Test: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx`

**Interfaces:**

- Consumes: existing `listUserJobs({ limit, offset })` and `listAssignmentSessions(limit)` APIs
- Produces: `resumeHasMore`, `resumeLoadingMore`, `resumeLoadMoreError`, and `loadMoreResumeJobs(): Promise<void>` from `useMinimalAssignmentResume`

- [ ] **Step 1: Write failing integration tests for append, retry, exhaustion, and selection**

Add a focused group that mocks the initial collections and a later page:

```ts
vi.mocked(api.listUserJobs)
  .mockResolvedValueOnce({ jobs: initialJobs, total: 25, limit: 20, offset: 0 })
  .mockResolvedValueOnce({ jobs: laterJobs, total: 25, limit: 20, offset: 20 });
vi.mocked(api.listAssignmentSessions)
  .mockResolvedValueOnce({ sessions: initialSessions, total: 22, limit: 20 })
  .mockResolvedValueOnce({ sessions: allSessions, total: 22, limit: 40 });

await user.click(await screen.findByRole('button', { name: 'Show older assignments' }));
await user.click(screen.getByRole('button', { name: 'Load more' }));

expect(api.listUserJobs).toHaveBeenLastCalledWith({ limit: 20, offset: 20 });
expect(api.listAssignmentSessions).toHaveBeenLastCalledWith(40);
expect(screen.getByRole('radio', { name: /older learner/i })).toBeTruthy();
```

Also prove a rejected later request leaves existing rows and selection in place and exposes a bottom-local `Try again`.

- [ ] **Step 2: Run the focused integration group and verify it fails**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx --testTimeout=15000
```

Expected: FAIL because the hook exposes no later-page state or callback.

- [ ] **Step 3: Add total, loading, and error state to the resume hook**

Add:

```ts
const RESUME_COLLECTION_PAGE_SIZE = 20;
const [resumeJobsTotal, setResumeJobsTotal] = useState(0);
const [assignmentSessionsTotal, setAssignmentSessionsTotal] = useState(0);
const [resumeLoadingMore, setResumeLoadingMore] = useState(false);
const [resumeLoadMoreError, setResumeLoadMoreError] = useState<string | null>(null);

const resumeHasMore =
  resumeJobs.length < resumeJobsTotal || assignmentSessions.length < assignmentSessionsTotal;
```

Update `loadResumeJobs` to capture both response totals and clear later-page errors on a successful refresh.

- [ ] **Step 4: Implement deduplicating incremental loading**

Add a callback that loads only non-exhausted sources, replaces the larger-limit session prefix, appends jobs by ID, and preserves selection:

```ts
const loadMoreResumeJobs = useCallback(async (): Promise<void> => {
  setResumeLoadingMore(true);
  setResumeLoadMoreError(null);
  try {
    const [jobsResponse, sessionsResponse] = await Promise.all([
      resumeJobs.length < resumeJobsTotal
        ? listUserJobs({ limit: RESUME_COLLECTION_PAGE_SIZE, offset: resumeJobs.length })
        : Promise.resolve(null),
      assignmentSessions.length < assignmentSessionsTotal
        ? listAssignmentSessions(assignmentSessions.length + RESUME_COLLECTION_PAGE_SIZE)
        : Promise.resolve(null),
    ]);

    if (jobsResponse) {
      setResumeJobs((current) => {
        const byId = new Map(current.map((job) => [job.jobId, job]));
        for (const job of jobsResponse.jobs ?? []) byId.set(job.jobId, job);
        return [...byId.values()];
      });
      setResumeJobsTotal(jobsResponse.total);
    }
    if (sessionsResponse) {
      setAssignmentSessions(sessionsResponse.sessions ?? []);
      setAssignmentSessionsTotal(sessionsResponse.total);
    }
  } catch (error) {
    setResumeLoadMoreError(
      error instanceof Error ? error.message : 'Unable to load older assignments.',
    );
  } finally {
    setResumeLoadingMore(false);
  }
}, [assignmentSessions.length, assignmentSessionsTotal, resumeJobs.length, resumeJobsTotal]);
```

Return the four new fields from the hook.

- [ ] **Step 5: Run the integration group and verify it passes**

Run the command from Step 2.

Expected: PASS for initial loading, later-page merge, retry, exhaustion, and stable selection.

- [ ] **Step 6: Commit incremental loading**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx
git commit -m "feat(batch-frontend): load older assignment history"
```

---

### Task 3: Lineage selection, version disclosure, and progressive visibility

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/assignments/steps/AssignmentEntryStep.tsx`
- Test: `packages/batch-frontend/src/ui/assignments/steps/AssignmentEntryStep.test.tsx`

**Interfaces:**

- Consumes: `RecentAssignmentLineage[]` and the incremental-loading fields from Tasks 1-2
- Produces: accessible lineage rows, exact-version radios, local four/eight visibility, and the `N versions` pill disclosure

- [ ] **Step 1: Write failing component tests for the approved interaction**

Extend `EntryHarness` to accept lineages and loading props. Add tests proving:

```ts
expect(screen.getAllByRole('radio')).toHaveLength(4);
expect(screen.getByRole('button', { name: 'Show older assignments' })).toBeTruthy();

await user.click(screen.getByRole('button', { name: '3 versions' }));
expect(screen.getByRole('button', { name: '3 versions' }).getAttribute('aria-expanded')).toBe(
  'true',
);
expect(screen.getByRole('radio', { name: /Previous rerun.*Published/i })).toBeTruthy();
expect(screen.getByRole('radio', { name: /Original.*Published/i })).toBeTruthy();
expect(screen.getAllByText('Yulia G')).toHaveLength(1);

await user.click(screen.getByRole('button', { name: 'Show older assignments' }));
expect(screen.getAllByRole('radio')).toHaveLength(12);
expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
```

Also prove the selected older version supplies its own action label and `onOpenRecent` still receives the selected exact ID through the existing callback path.

- [ ] **Step 2: Run the focused component test and verify it fails**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/steps/AssignmentEntryStep.test.tsx --testTimeout=15000
```

Expected: FAIL because the component still receives flat rows and has no lineage disclosure or progressive visibility.

- [ ] **Step 3: Build and pass lineages from `MinimalAssignment`**

Memoize lineages after flat item presentation:

```ts
const resumeLineages = useMemo(
  () => buildRecentAssignmentLineages(resumeJobItems),
  [resumeJobItems],
);
```

Pass `recentLineages`, `recentHasMore`, `recentLoadingMore`, `recentLoadMoreError`, and `onLoadMoreRecent` to `AssignmentEntryStep`.

- [ ] **Step 4: Implement local visibility and expansion state**

Add constants and state:

```ts
const INITIAL_RECENT_LINEAGES = 4;
const MORE_RECENT_LINEAGES = 8;

const [visibleLineageCount, setVisibleLineageCount] = useState(INITIAL_RECENT_LINEAGES);
const [expandedLineageIds, setExpandedLineageIds] = useState<Set<string>>(() => new Set());
const visibleLineages = recentLineages.slice(0, visibleLineageCount);
const canShowMore = visibleLineageCount < recentLineages.length || recentHasMore;
```

Reset these local states only when leaving the Resume route. When an appended parent moves the selected job into `olderVersions`, automatically retain that lineage ID in the expanded set.

The load handler increments the desired lineage count by eight, calls `onLoadMoreRecent` only when the desired count exceeds locally loaded lineages, and leaves existing rows in place during the request.

- [ ] **Step 5: Render separate selection labels and disclosure buttons**

Use a grid container with native radio plus associated labels, keeping the disclosure button outside all labels:

```tsx
const STEP_NUMBER_BY_DESTINATION = {
  source: 2,
  context: 3,
  create: 4,
  review: 5,
} as const;

function RecentStateIcon({ item }: { item: RecentAssignmentItem }) {
  if (item.state === 'unfinished') {
    return <span aria-hidden="true">{STEP_NUMBER_BY_DESTINATION[item.destination]}</span>;
  }
  if (item.state === 'in-progress') return <RefreshCw aria-hidden="true" />;
  if (item.state === 'ready-to-share') return <FileCheck2 aria-hidden="true" />;
  if (item.state === 'published') return <Check aria-hidden="true" />;
  return <AlertCircle aria-hidden="true" />;
}
```

```tsx
<div className={`assignment-entry-step__recent-row${latest.selected ? ' is-selected' : ''}`}>
  <input id={radioId} type="radio" name="recent-assignment" checked={latest.selected} />
  <label htmlFor={radioId} className="assignment-entry-step__recent-learner">
    {latest.learnerName}
  </label>
  <div className="assignment-entry-step__recent-anchor">
    <label htmlFor={radioId}>{latest.recoveryAnchor}</label>
    {lineage.olderVersions.length > 0 ? (
      <span className="assignment-entry-step__version-disclosure">
        <span>Latest rerun ·</span>
        <button
          type="button"
          className="assignment-entry-step__version-pill"
          aria-expanded={expanded}
          aria-controls={historyId}
        >
          {lineage.olderVersions.length + 1} versions
          <ChevronUp aria-hidden="true" />
        </button>
      </span>
    ) : null}
  </div>
  <label htmlFor={radioId} className="assignment-entry-step__recent-state">
    <RecentStateIcon item={latest} />
    <span>
      <strong>{latest.statusLabel}</strong>
      <time>{latest.timeLabel}</time>
    </span>
  </label>
</div>
```

Render earlier versions in a slim history region with only radio, `Previous rerun`/`Original`, and the shared state rail. Do not render decorative connector nodes.

- [ ] **Step 6: Render bottom-local progressive loading and errors**

Keep `Show older assignments` for the first disclosure and `Load more` afterward. Preserve existing rows while busy, expose `aria-busy`, and render `Try again` beside `recentLoadMoreError`.

- [ ] **Step 7: Run focused component and integration tests**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/steps/AssignmentEntryStep.test.tsx src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx --testTimeout=15000
```

Expected: PASS for route mutual exclusion, four-lineage default, eight-lineage appends, disclosure semantics, exact-version selection, and status-specific actions.

- [ ] **Step 8: Commit the interaction**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx packages/batch-frontend/src/ui/assignments/steps/AssignmentEntryStep.tsx packages/batch-frontend/src/ui/assignments/steps/AssignmentEntryStep.test.tsx
git commit -m "feat(batch-frontend): refine assignment resume choice"
```

---

### Task 4: Approved styling, responsive behavior, and documentation alignment

**Files:**

- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.css`
- Modify: `packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.responsive.test.tsx`
- Modify: `packages/batch-frontend/README.md`
- Modify: `docs/backend-frontend/backend-frontend-alignment.md`

**Interfaces:**

- Consumes: Task 3 class names and state markup
- Produces: the approved visual hierarchy at desktop/narrow widths and current behavior documentation

- [ ] **Step 1: Write failing CSS-contract tests**

Assert the stylesheet contains the approved grid and interaction hooks and excludes decorative history nodes:

```ts
expect(css).toContain(
  'grid-template-columns: 20px minmax(150px, 0.75fr) minmax(220px, 1.35fr) 156px',
);
expect(css).toContain('.assignment-entry-step__version-pill:hover');
expect(css).toContain('.assignment-entry-step__version-pill:focus-visible');
expect(css).toContain('@media (prefers-reduced-motion: reduce)');
expect(css).not.toContain('.assignment-entry-step__version-row::before');
```

- [ ] **Step 2: Run the responsive test and verify it fails**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/assignments/AssignmentWorkflow.responsive.test.tsx --testTimeout=15000
```

Expected: FAIL because the approved grid, pill states, and history styles do not exist.

- [ ] **Step 3: Implement the approved desktop styling**

Replace the tall stacked-row rules with:

```css
.assignment-entry-step__recent-row {
  display: grid;
  grid-template-columns: 20px minmax(150px, 0.75fr) minmax(220px, 1.35fr) 156px;
  align-items: center;
  gap: 0.75rem;
  min-height: 58px;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--cs-border);
  border-radius: 10px;
  background: var(--cs-surface);
}

.assignment-entry-step__recent-state {
  display: grid;
  grid-template-columns: 22px 118px;
  gap: 0.5rem;
  width: 148px;
  justify-self: end;
}

.assignment-entry-step__version-pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  gap: 0.25rem;
  padding: 0.15rem 0.55rem;
  border: 1px solid color-mix(in srgb, var(--cs-action) 38%, var(--cs-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--cs-action) 6%, var(--cs-surface));
  color: var(--cs-action);
}

.assignment-entry-step__version-pill:hover {
  border-color: color-mix(in srgb, var(--cs-action) 64%, var(--cs-border));
  background: color-mix(in srgb, var(--cs-action) 11%, var(--cs-surface));
}
```

Use lucide icons already in the package: `Check`, `FileCheck2`, `RefreshCw`, `AlertCircle`, and numeric text for unfinished session steps. Icon containers alone receive semantic tint.

- [ ] **Step 4: Implement the history thread and narrow layout**

Use one vertical rule on the history container and short horizontal strokes on version rows. Do not add circle pseudo-elements. At `max-width: 620px`, keep learner and status on the first row and place recovery/version content beneath them. Disable transition movement in reduced-motion mode.

- [ ] **Step 5: Update behavior documentation**

In the package README and alignment table, state that Step 1 shows four recent assignment lineages, collapses reruns through `sourceJobId`, preserves exact versions, and loads older lineages progressively through existing job/session APIs. Do not claim lesson-title retrieval or a general assignment archive.

- [ ] **Step 6: Run focused tests and formatting**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run src/ui/minimal/MinimalAssignment.resume-presentation.test.ts src/ui/assignments/steps/AssignmentEntryStep.test.tsx src/ui/assignments/AssignmentWorkflow.responsive.test.tsx src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx --testTimeout=15000
pnpm format:write
pnpm format
```

Expected: all focused tests and formatting checks pass.

- [ ] **Step 7: Run the normal pre-push gate**

Run:

```bash
pnpm --silent run check:fast:agent
```

Expected: PASS, or an explicit affected-scope fallback to `check:pre-pr` that also passes.

- [ ] **Step 8: Commit styling and docs**

```bash
git add packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.css packages/batch-frontend/src/ui/assignments/AssignmentWorkflow.responsive.test.tsx packages/batch-frontend/README.md docs/backend-frontend/backend-frontend-alignment.md
git commit -m "style(batch-frontend): polish assignment resume history"
```

---

## Plan Self-Review

- Spec coverage: Tasks 1-4 cover contract-backed anchors, fixed state rails, source-linked lineages, precise version selection, the approved pill, progressive older loading, loading/error states, responsive behavior, accessibility, docs, and validation.
- Scope: all changes remain within the existing frontend and documentation surfaces; no backend or contract task is included.
- Type consistency: `RecentAssignmentLineage`, `buildRecentAssignmentLineages`, `resumeHasMore`, `resumeLoadingMore`, `resumeLoadMoreError`, and `loadMoreResumeJobs` are introduced once and consumed by later tasks under the same names.
- Placeholder scan: no unresolved markers, deferred implementation, generic error-handling instruction, or unnamed test step remains.

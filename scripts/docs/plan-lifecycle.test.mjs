import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runDocsChecks } from './docs-check-lib.mjs';
import { buildPlanIndexRows, buildPlanLifecycleReport } from './plan-lifecycle-lib.mjs';

const baseConfig = {
  core_docs: [],
  active_ops_docs: [],
  non_core_docs: [],
  exclude_prefixes: ['docs/archive/'],
  docs_gardening: {
    plan_lifecycle: {
      route_source: 'docs/plans/README.md',
      allowed_active_statuses: ['active', 'roadmap', 'backlog', 'draft'],
      archive_prefix: 'docs/archive/plans/',
      noneditable_route_sources: [
        'docs/README.md',
        'docs/reference/DOCS_IA_MAP.md',
        'docs/plans/README.md',
      ],
    },
  },
};

test('docs check fails completed and superseded plans left under docs/plans', () => {
  const repoRoot = makeRepo({
    'docs/plans/README.md': planRouter(['docs/plans/completed-work.md']),
    'docs/plans/completed-work.md': planDoc({
      status: 'completed',
      exitTrigger: 'archive after implementation PR merges',
    }),
  });

  const result = runDocsChecks('non_core', { repoRoot, config: baseConfig });

  assert.match(result.errors.join('\n'), /completed-work\.md/);
  assert.match(result.errors.join('\n'), /completed.*docs\/archive\/plans/);
});

test('docs check fails active routed plans without an exit trigger', () => {
  const repoRoot = makeRepo({
    'docs/plans/README.md': planRouter(['docs/plans/topic/README.md']),
    'docs/plans/topic/README.md': planDoc({
      status: 'active',
      exitTrigger: null,
      currentFocus: 'edit this topic README only',
    }),
  });

  const result = runDocsChecks('non_core', { repoRoot, config: baseConfig });

  assert.match(result.errors.join('\n'), /topic\/README\.md/);
  assert.match(result.errors.join('\n'), /Exit Trigger/);
});

test('docs check fails active routed plans without current focus', () => {
  const repoRoot = makeRepo({
    'docs/plans/README.md': planRouter(['docs/plans/topic/README.md']),
    'docs/plans/topic/README.md': planDoc({
      status: 'roadmap',
      exitTrigger: 'archive after implementation PR merges',
      currentFocus: null,
    }),
  });

  const result = runDocsChecks('non_core', { repoRoot, config: baseConfig });

  assert.match(result.errors.join('\n'), /topic\/README\.md/);
  assert.match(result.errors.join('\n'), /Current Focus/);
});

test('docs check fails orphan standalone plans under docs/plans', () => {
  const repoRoot = makeRepo({
    'docs/plans/README.md': planRouter([]),
    'docs/plans/forgotten.md': planDoc({
      status: 'active',
      exitTrigger: 'archive after implementation PR merges',
      currentFocus: 'archive this orphan or route it explicitly',
    }),
  });

  const result = runDocsChecks('non_core', { repoRoot, config: baseConfig });

  assert.match(result.errors.join('\n'), /forgotten\.md/);
  assert.match(result.errors.join('\n'), /standalone plan is not routed/);
});

test('docs check ignores completed plans already under docs/archive/plans', () => {
  const repoRoot = makeRepo({
    'docs/plans/README.md': planRouter([]),
    'docs/archive/plans/completed/done.md': planDoc({
      status: 'completed',
      exitTrigger: 'archived after implementation PR merged',
      currentFocus: null,
    }),
  });

  const result = runDocsChecks('non_core', { repoRoot, config: baseConfig });

  assert.deepEqual(result.errors, []);
});

test('generated plan rows classify routed active and archived plans by editability', () => {
  const repoRoot = makeRepo({
    'docs/plans/README.md': planRouter(['docs/plans/topic/README.md']),
    'docs/plans/topic/README.md': planDoc({
      status: 'active',
      exitTrigger: 'archive after implementation PR merges',
      currentFocus: 'edit this topic README only',
    }),
    'docs/archive/plans/completed/done.md': planDoc({
      status: 'completed',
      exitTrigger: 'archived after implementation PR merged',
      currentFocus: null,
    }),
  });

  const rows = buildPlanIndexRows({ repoRoot, config: baseConfig });
  const active = rows.find((row) => row.path === 'docs/plans/topic/README.md');
  const archived = rows.find((row) => row.path === 'docs/archive/plans/completed/done.md');

  assert.equal(active?.status, 'active');
  assert.equal(active?.routed, 'yes');
  assert.equal(active?.editable, 'yes');
  assert.equal(active?.currentFocus, 'edit this topic README only');
  assert.equal(archived?.status, 'completed');
  assert.equal(archived?.routed, 'no');
  assert.equal(archived?.editable, 'no');
});

test('docs check fails top-level routers that point at non-editable phase detail plans', () => {
  const repoRoot = makeRepo({
    'docs/README.md': '- Detail: `docs/plans/topic/phase-1.md`',
    'docs/reference/DOCS_IA_MAP.md': '# IA',
    'docs/plans/README.md': planRouter(['docs/plans/topic/README.md']),
    'docs/plans/topic/README.md': planDoc({
      status: 'roadmap',
      exitTrigger: 'archive after implementation PR merges',
      currentFocus: 'edit this topic README only',
    }),
    'docs/plans/topic/phase-1.md': planDoc({
      status: '',
      exitTrigger: null,
      currentFocus: null,
    }),
  });

  const result = runDocsChecks('non_core', { repoRoot, config: baseConfig });

  assert.match(result.errors.join('\n'), /docs\/README\.md/);
  assert.match(result.errors.join('\n'), /phase-1\.md/);
  assert.match(result.errors.join('\n'), /non-editable/);
});

test('docs check fails active statuses on non-editable phase detail plans', () => {
  const repoRoot = makeRepo({
    'docs/plans/README.md': planRouter(['docs/plans/topic/README.md']),
    'docs/plans/topic/README.md': planDoc({
      status: 'roadmap',
      exitTrigger: 'archive after implementation PR merges',
      currentFocus: 'edit this topic README only',
    }),
    'docs/plans/topic/phase-1.md': planDoc({
      status: 'active',
      exitTrigger: 'archive after implementation PR merges',
      currentFocus: 'phase is still current',
    }),
  });

  const result = runDocsChecks('non_core', { repoRoot, config: baseConfig });

  assert.match(result.errors.join('\n'), /phase-1\.md/);
  assert.match(result.errors.join('\n'), /active.*editable/);
});

test('plan lifecycle report separates editable active, active-tree historical, archived, and contradictions', () => {
  const repoRoot = makeRepo({
    'docs/plans/README.md': planRouter(['docs/plans/topic/README.md']),
    'docs/plans/topic/README.md': planDoc({
      status: 'roadmap',
      exitTrigger: 'archive after implementation PR merges',
      currentFocus: 'edit this topic README only',
    }),
    'docs/plans/topic/phase-1.md': planDoc({
      status: '',
      exitTrigger: null,
      currentFocus: null,
    }),
    'docs/plans/topic/phase-2.md': planDoc({
      status: 'active',
      exitTrigger: 'archive after implementation PR merges',
      currentFocus: 'phase is still current',
    }),
    'docs/archive/plans/topic/phase-0.md': planDoc({
      status: 'completed',
      exitTrigger: 'archived after implementation PR merged',
      currentFocus: null,
    }),
  });

  const report = buildPlanLifecycleReport({ repoRoot, config: baseConfig });

  assert.equal(report.counts.editableActive, 1);
  assert.equal(report.counts.activeTreeHistorical, 1);
  assert.equal(report.counts.archived, 1);
  assert.equal(report.counts.statusEditabilityContradictions, 1);
});

function makeRepo(files) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-lifecycle-test-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
  }
  return repoRoot;
}

function planRouter(paths) {
  return [
    '# Plans Directory',
    '',
    '## Active Plan Routes',
    '',
    ...paths.map((item) => `- \`${item}\``),
    '',
  ].join('\n');
}

function planDoc({ status, exitTrigger, currentFocus = 'edit this plan directly' }) {
  return [
    '# Example Plan',
    '',
    '## Meta',
    '',
    '- Audience: maintainers and AI agents.',
    '- Authority Level: execution plan.',
    '- Last Verified Against: 2026-05-17 repo state.',
    '- Owner: founder-maintainer + automation agents.',
    '- Review Cadence: after implementation PR.',
    ...(status === '' ? [] : [`- Status: \`${status}\`.`]),
    ...(exitTrigger ? [`- Exit Trigger: ${exitTrigger}.`] : []),
    ...(currentFocus ? [`- Current Focus: ${currentFocus}.`] : []),
    '',
    '## Summary',
    '',
    '- Example.',
    '',
  ].join('\n');
}

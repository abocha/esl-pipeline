import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  composeDocsGardeningSnapshot,
  writeDocsGardeningArtifacts,
} from './docs-gardening-lib.mjs';

const baseConfig = {
  core_docs: ['AGENTS.md', 'docs/README.md'],
  active_ops_docs: ['docs/operations/postgres-ops-health.md'],
  non_core_docs: ['docs/reference/env.md'],
  docs_gardening: {
    rolling_issue_title: 'docs-gardening',
    golden_set_docs: ['AGENTS.md', 'docs/reference/agents-ssot.md'],
    low_signal_prefixes: [],
  },
};

test('docs gardening snapshot emits one rolling issue and triage-oriented state', () => {
  const checks = {
    core: {
      scope: 'core',
      docsChecked: 2,
      errors: ['[broken-link] docs/README.md -> missing.md'],
      warnings: [],
    },
    ops: {
      scope: 'ops',
      docsChecked: 1,
      errors: [],
      warnings: ['[stale-warning] docs/reference/agents-ssot.md is 90 days old (warn > 60)'],
    },
    non_core: {
      scope: 'non_core',
      docsChecked: 1,
      errors: [],
      warnings: [],
    },
    metrics: {
      checkedDocs: 4,
      errors: 1,
      warnings: 1,
    },
  };

  const health = {
    dimensions: {
      routing_clarity: 8,
      authority_ownership_clarity: 9,
      freshness_drift_resistance: 7.5,
      mechanical_enforceability: 9.2,
      ops_runbook_reliability: 8.7,
      archive_hygiene: 8.8,
      agent_onboarding_speed: 8.2,
    },
    composite: 8.49,
  };

  const staleActive = {
    generatedAt: '2026-04-03T00:00:00.000Z',
    totalCandidates: 2,
    countsByPriority: { P1: 0, P2: 1, P3: 1 },
    reasonCounts: {
      'no-route-coverage': 2,
    },
    topCandidates: [
      {
        path: 'docs/reference/custom-flow.md',
        priority: 'P2',
        confidence: 'high',
        daysOld: 123,
        inboundRefs: 0,
        stalePathRefs: 1,
        overlapWithNewerCount: 0,
        overlapWithNewerExamples: [],
        score: 5,
        reasons: ['stale-by-age', 'no-route-coverage', 'stale-path-ref'],
        lastCommitDate: '2025-12-01',
      },
      {
        path: 'docs/reference/secondary-flow.md',
        priority: 'P3',
        confidence: 'low',
        daysOld: 15,
        inboundRefs: 0,
        stalePathRefs: 0,
        overlapWithNewerCount: 0,
        overlapWithNewerExamples: [],
        score: 2,
        reasons: ['no-route-coverage'],
        lastCommitDate: '2026-03-19',
      },
    ],
  };

  const report = composeDocsGardeningSnapshot({
    generatedAt: '2026-04-03T00:00:00.000Z',
    checks,
    health,
    staleActive,
    config: baseConfig,
  });

  assert.equal(report.summary.status, 'failing');
  assert.equal(report.hardGates.count, 1);
  assert.equal(report.warnings.count, 1);
  assert.equal(report.manualReviewQueue.count, 3);
  assert.equal(report.issue.action, 'create-or-update');
  assert.equal(report.issue.title, 'docs-gardening');
  assert.match(report.issue.body, /Hard Gate Findings/);
  assert.match(report.issue.body, /Review This Week/);
  assert.doesNotMatch(report.issue.body, /issue payloads/i);
});

test('clean snapshot closes the rolling issue', () => {
  const checks = {
    core: { scope: 'core', docsChecked: 2, errors: [], warnings: [] },
    ops: { scope: 'ops', docsChecked: 1, errors: [], warnings: [] },
    non_core: { scope: 'non_core', docsChecked: 1, errors: [], warnings: [] },
    metrics: { checkedDocs: 4, errors: 0, warnings: 0 },
  };

  const health = {
    dimensions: {
      routing_clarity: 10,
      authority_ownership_clarity: 10,
      freshness_drift_resistance: 10,
      mechanical_enforceability: 10,
      ops_runbook_reliability: 10,
      archive_hygiene: 9,
      agent_onboarding_speed: 10,
    },
    composite: 9.86,
  };

  const staleActive = {
    generatedAt: '2026-04-03T00:00:00.000Z',
    totalCandidates: 0,
    countsByPriority: { P1: 0, P2: 0, P3: 0 },
    reasonCounts: {},
    topCandidates: [],
  };

  const report = composeDocsGardeningSnapshot({
    generatedAt: '2026-04-03T00:00:00.000Z',
    checks,
    health,
    staleActive,
    config: baseConfig,
  });

  assert.equal(report.summary.status, 'clean');
  assert.equal(report.issue.action, 'close');
  assert.match(report.issue.body, /No current docs-gardening action required/);
});

test('heuristic-only snapshot becomes review-suggested instead of failing', () => {
  const checks = {
    core: { scope: 'core', docsChecked: 2, errors: [], warnings: [] },
    ops: { scope: 'ops', docsChecked: 1, errors: [], warnings: [] },
    non_core: { scope: 'non_core', docsChecked: 1, errors: [], warnings: [] },
    metrics: { checkedDocs: 4, errors: 0, warnings: 0 },
  };

  const health = {
    dimensions: {
      routing_clarity: 10,
      authority_ownership_clarity: 10,
      freshness_drift_resistance: 10,
      mechanical_enforceability: 10,
      ops_runbook_reliability: 10,
      archive_hygiene: 9,
      agent_onboarding_speed: 10,
    },
    composite: 9.86,
  };

  const staleActive = {
    generatedAt: '2026-04-03T00:00:00.000Z',
    totalCandidates: 1,
    countsByPriority: { P1: 0, P2: 0, P3: 1 },
    reasonCounts: { 'no-route-coverage': 1 },
    topCandidates: [
      {
        path: 'docs/reference/secondary-flow.md',
        priority: 'P3',
        confidence: 'low',
        daysOld: 5,
        inboundRefs: 0,
        stalePathRefs: 0,
        overlapWithNewerCount: 0,
        overlapWithNewerExamples: [],
        score: 2,
        reasons: ['no-route-coverage'],
        lastCommitDate: '2026-03-29',
      },
    ],
  };

  const report = composeDocsGardeningSnapshot({
    generatedAt: '2026-04-03T00:00:00.000Z',
    checks,
    health,
    staleActive,
    config: baseConfig,
  });

  assert.equal(report.summary.status, 'review-suggested');
  assert.equal(report.issue.action, 'create-or-update');
  assert.match(report.issue.body, /No hard failures/);
});

test('manual review queue includes stale P1 candidates before golden-set rotation', () => {
  const checks = {
    core: { scope: 'core', docsChecked: 2, errors: [], warnings: [] },
    ops: { scope: 'ops', docsChecked: 1, errors: [], warnings: [] },
    non_core: { scope: 'non_core', docsChecked: 1, errors: [], warnings: [] },
    metrics: { checkedDocs: 4, errors: 0, warnings: 0 },
  };
  const health = {
    dimensions: {
      routing_clarity: 10,
      authority_ownership_clarity: 10,
      freshness_drift_resistance: 10,
      mechanical_enforceability: 10,
      ops_runbook_reliability: 10,
      archive_hygiene: 9,
      agent_onboarding_speed: 10,
    },
    composite: 9.86,
  };
  const staleActive = {
    generatedAt: '2026-04-03T00:00:00.000Z',
    totalCandidates: 2,
    countsByPriority: { P1: 1, P2: 1, P3: 0 },
    reasonCounts: { 'stale-by-age': 2 },
    topCandidates: [
      {
        path: 'docs/reference/env.md',
        priority: 'P1',
        confidence: 'low',
        daysOld: 50,
        inboundRefs: 2,
        stalePathRefs: 0,
        overlapWithNewerCount: 0,
        overlapWithNewerExamples: [],
        score: 1,
        reasons: ['stale-by-age'],
        lastCommitDate: '2026-02-12',
      },
      {
        path: 'docs/reference/custom-flow.md',
        priority: 'P2',
        confidence: 'low',
        daysOld: 60,
        inboundRefs: 1,
        stalePathRefs: 0,
        overlapWithNewerCount: 0,
        overlapWithNewerExamples: [],
        score: 1,
        reasons: ['stale-by-age'],
        lastCommitDate: '2026-02-02',
      },
    ],
  };

  const report = composeDocsGardeningSnapshot({
    generatedAt: '2026-04-03T00:00:00.000Z',
    checks,
    health,
    staleActive,
    config: baseConfig,
  });

  assert.equal(report.manualReviewQueue.items[0]?.path, 'docs/reference/env.md');
});

test('docs gardening writer emits issue, health, and stale-active artifacts together', () => {
  const checks = {
    core: { scope: 'core', docsChecked: 2, errors: [], warnings: [] },
    ops: { scope: 'ops', docsChecked: 1, errors: [], warnings: [] },
    non_core: { scope: 'non_core', docsChecked: 1, errors: [], warnings: [] },
    metrics: { checkedDocs: 4, errors: 0, warnings: 0 },
  };
  const health = {
    dimensions: {
      routing_clarity: 10,
      authority_ownership_clarity: 10,
      freshness_drift_resistance: 10,
      mechanical_enforceability: 10,
      ops_runbook_reliability: 10,
      archive_hygiene: 9,
      agent_onboarding_speed: 10,
    },
    composite: 9.86,
  };
  const staleActive = {
    generatedAt: '2026-04-03T00:00:00.000Z',
    totalCandidates: 0,
    countsByPriority: { P1: 0, P2: 0, P3: 0 },
    reasonCounts: {},
    topCandidates: [],
  };
  const report = composeDocsGardeningSnapshot({
    generatedAt: '2026-04-03T00:00:00.000Z',
    checks,
    health,
    staleActive,
    config: baseConfig,
  });
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-gardening-test-'));
  const artifacts = writeDocsGardeningArtifacts(report, { repoRoot });

  for (const artifactPath of Object.values(artifacts)) {
    assert.equal(fs.existsSync(artifactPath), true, artifactPath);
  }
});

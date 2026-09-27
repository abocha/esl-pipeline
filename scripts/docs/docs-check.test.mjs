import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runDocsChecks } from './docs-check-lib.mjs';
import { buildDocsGardeningReport, buildDocsHealthReport } from './docs-gardening-lib.mjs';

const metaFields = [
  'Audience',
  'Authority Level',
  'Last Verified Against',
  'Owner',
  'Review Cadence',
  'Status',
];

const baseConfig = {
  core_docs: [],
  active_ops_docs: [],
  non_core_docs: ['docs/reference/example.md'],
  meta_required_docs: ['docs/reference/example.md'],
  meta_required_fields: metaFields,
  freshness_days: { non_core: 45 },
  exclude_prefixes: ['docs/archive/'],
  docs_gardening: {
    stale_scan_roots: [],
    route_sources: [],
    golden_set_docs: [],
    plan_lifecycle: {
      route_source: 'docs/plans/README.md',
      allowed_active_statuses: ['active', 'roadmap', 'backlog', 'draft'],
      archive_prefix: 'docs/archive/plans/',
      noneditable_route_sources: [],
    },
  },
};

const staleDate = '2026-01-01';
const now = new Date('2026-03-01T00:00:00.000Z');

test('PR docs checks do not block on untouched non-core age-only staleness', () => {
  const repoRoot = makeRepo({ 'docs/reference/example.md': documentation(staleDate) });

  const result = runDocsChecks('non_core', {
    repoRoot,
    config: baseConfig,
    freshnessMode: 'pr',
    changedFiles: ['packages/unrelated/src/index.ts'],
    now,
  });

  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join('\n'), /stale-doc-age-only.*example\.md/u);
});

test('PR docs checks do not couple stale operations documents to changed siblings', () => {
  const staleDoc = 'docs/operations/a.md';
  const repoRoot = makeRepo({
    [staleDoc]: documentation(staleDate),
    'docs/operations/b.md': documentation(staleDate),
  });
  const config = {
    ...baseConfig,
    active_ops_docs: [staleDoc],
    meta_required_docs: [staleDoc],
    freshness_days: { ops: 45 },
  };

  const result = runDocsChecks('ops', {
    repoRoot,
    config,
    freshnessMode: 'pr',
    changedFiles: ['docs/operations/b.md'],
    now,
  });

  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join('\n'), /stale-doc-age-only.*docs\/operations\/a\.md/u);
});

test('checker implementation changes leave unrelated age-only staleness as a warning', () => {
  const repoRoot = makeRepo({ 'docs/reference/example.md': documentation(staleDate) });
  const result = runDocsChecks('non_core', {
    repoRoot,
    config: baseConfig,
    freshnessMode: 'pr',
    changedFiles: ['scripts/docs/docs-check-lib.mjs'],
    now,
  });

  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join('\n'), /stale-doc-age-only.*example\.md/u);
});

test('freshness policy configuration changes recheck configured document ages', () => {
  const repoRoot = makeRepo({ 'docs/reference/example.md': documentation(staleDate) });
  const result = runDocsChecks('non_core', {
    repoRoot,
    config: baseConfig,
    freshnessMode: 'pr',
    changedFiles: ['scripts/docs/docs-check.config.json'],
    now,
  });

  assert.match(result.errors.join('\n'), /stale-doc.*example\.md/u);
});

test('PR docs checks block stale documentation touched by the PR', () => {
  const repoRoot = makeRepo({ 'docs/reference/example.md': documentation(staleDate) });

  const result = runDocsChecks('non_core', {
    repoRoot,
    config: baseConfig,
    freshnessMode: 'pr',
    changedFiles: ['docs/reference/example.md'],
    now,
  });

  assert.match(result.errors.join('\n'), /stale-doc.*example\.md/u);
  assert.doesNotMatch(result.warnings.join('\n'), /stale-doc-age-only/u);
});

test('PR docs checks treat a changed package as the ownership surface for its README', () => {
  const config = {
    ...baseConfig,
    non_core_docs: ['packages/example/README.md'],
    meta_required_docs: ['packages/example/README.md'],
  };
  const repoRoot = makeRepo({ 'packages/example/README.md': documentation(staleDate) });

  const result = runDocsChecks('non_core', {
    repoRoot,
    config,
    freshnessMode: 'pr',
    changedFiles: ['packages/example/src/index.js'],
    now,
  });

  assert.match(result.errors.join('\n'), /stale-doc.*packages\/example\/README\.md/u);
});

test('PR docs checks treat an explicit package reference as an ownership surface', () => {
  const repoRoot = makeRepo({
    'docs/reference/example.md': documentation(staleDate, 'Owned by `@esl-pipeline/example`.'),
  });

  const result = runDocsChecks('non_core', {
    repoRoot,
    config: baseConfig,
    freshnessMode: 'pr',
    changedFiles: ['packages/example/src/index.js'],
    now,
  });

  assert.match(result.errors.join('\n'), /stale-doc.*example\.md/u);
});

test('structural documentation failures remain blocking when age-only staleness is scoped', () => {
  const repoRoot = makeRepo({
    'docs/reference/example.md': documentation(staleDate, '[missing](does-not-exist.md)'),
  });

  const result = runDocsChecks('non_core', {
    repoRoot,
    config: baseConfig,
    freshnessMode: 'pr',
    changedFiles: ['packages/unrelated/src/index.ts'],
    now,
  });

  assert.match(result.errors.join('\n'), /broken-link.*does-not-exist\.md/u);
  assert.match(result.warnings.join('\n'), /stale-doc-age-only/u);
});

test('invalid freshness metadata remains blocking when age-only staleness is scoped', () => {
  const repoRoot = makeRepo({ 'docs/reference/example.md': documentation('2026-13-01') });

  const result = runDocsChecks('non_core', {
    repoRoot,
    config: baseConfig,
    freshnessMode: 'pr',
    changedFiles: ['packages/unrelated/src/index.ts'],
    now,
  });

  assert.match(result.errors.join('\n'), /invalid-freshness.*2026-13-01/u);
});

test('full docs health and gardening reports keep age-driven stale documents visible', () => {
  const repoRoot = makeRepo({ 'docs/reference/example.md': documentation(staleDate) });

  const health = buildDocsHealthReport({ repoRoot, config: baseConfig, now });
  const gardening = buildDocsGardeningReport({
    repoRoot,
    config: baseConfig,
    now,
    generatedAt: now.toISOString(),
  });

  assert.match(health.checks.non_core.errors.join('\n'), /stale-doc.*example\.md/u);
  assert.match(gardening.checks.non_core.errors.join('\n'), /stale-doc.*example\.md/u);
  assert.match(gardening.issue.body, /example\.md/u);
});

function makeRepo(files) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-check-test-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(repoRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
  }
  return repoRoot;
}

function documentation(lastVerified, body = '') {
  return [
    '# Example',
    '',
    '## Meta',
    ...metaFields.map(
      (field) => `- ${field}: ${field === 'Last Verified Against' ? lastVerified : 'test'}`,
    ),
    '',
    body,
    '',
  ].join('\n');
}

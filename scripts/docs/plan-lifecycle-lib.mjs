import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ACTIVE_STATUSES = ['active', 'roadmap', 'backlog', 'draft'];
const COMPLETED_STATUSES = new Set(['completed', 'superseded']);
const DEFAULT_ARCHIVE_PREFIX = 'docs/archive/plans/';
const DEFAULT_ROUTE_SOURCE = 'docs/plans/README.md';

export function buildPlanLifecycleReport({
  repoRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  config = {},
} = {}) {
  const rows = buildPlanIndexRows({ repoRoot, config });
  const hardGateIssues = validatePlanLifecycleRows(rows, { config });
  const counts = rows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.editable === 'yes') acc.editable += 1;
      if (row.path.startsWith(DEFAULT_ARCHIVE_PREFIX)) acc.archived += 1;
      if (row.routed === 'yes') acc.routed += 1;
      return acc;
    },
    { total: 0, editable: 0, archived: 0, routed: 0 },
  );

  return {
    generatedAt,
    counts,
    hardGateIssues,
    rows,
  };
}

export function writePlanLifecycleArtifacts(
  report,
  { repoRoot = process.cwd(), outDir = path.join(repoRoot, 'tmp') } = {},
) {
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, 'docs-plan-lifecycle.json');
  const mdPath = path.join(outDir, 'docs-plan-lifecycle.md');

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, `${toPlanLifecycleMarkdown(report)}\n`, 'utf8');

  return { jsonPath, mdPath };
}

export function buildPlanIndexRows({ repoRoot = process.cwd(), config = {} } = {}) {
  const routeSet = collectPlanRouteSet({ repoRoot, config });
  const files = [
    ...collectMarkdownFiles(path.join(repoRoot, 'docs/plans'), 'docs/plans'),
    ...collectMarkdownFiles(path.join(repoRoot, 'docs/archive/plans'), 'docs/archive/plans'),
  ].sort((left, right) => left.localeCompare(right));

  return files.map((relativePath) => {
    const content = readFileIfExists(path.join(repoRoot, relativePath));
    const status = normalizeStatus(readMetaField(content, 'Status')) || inferStatus(relativePath);
    const lastVerified = normalizeMetaText(readMetaField(content, 'Last Verified Against'));
    const exitTrigger = normalizeMetaText(readMetaField(content, 'Exit Trigger'));
    const routed = routeSet.has(relativePath) ? 'yes' : 'no';
    const rawKind = classifyPlanPath(relativePath);
    const kind = routed === 'yes' && rawKind === 'phase/detail' ? 'standalone' : rawKind;
    const title = readMarkdownTitle(content, path.basename(relativePath));
    const editable = classifyEditability({
      relativePath,
      kind,
      status,
      routed,
      config,
    });

    return {
      kind,
      title,
      status,
      lastVerified,
      routed,
      editable,
      exitTrigger,
      path: relativePath,
    };
  });
}

export function validatePlanLifecycleRows(rows, { config = {} } = {}) {
  const allowedStatuses = getAllowedStatuses(config);
  const issues = [];

  for (const row of rows) {
    if (!row.path.startsWith('docs/plans/')) continue;
    if (row.path === 'docs/plans/README.md') continue;

    if (COMPLETED_STATUSES.has(row.status)) {
      issues.push({
        code: 'plan-active-completed',
        path: row.path,
        message: `status '${row.status}' belongs under docs/archive/plans/`,
      });
      continue;
    }

    if (row.status && !allowedStatuses.has(row.status)) {
      issues.push({
        code: 'plan-invalid-status',
        path: row.path,
        message: `status '${row.status}' is not allowed under docs/plans/`,
      });
    }

    if (row.kind === 'standalone' && row.routed === 'no') {
      issues.push({
        code: 'plan-orphan-standalone',
        path: row.path,
        message: 'standalone plan is not routed from docs/plans/README.md',
      });
    }

    if (requiresActiveMetadata(row) && row.routed === 'yes') {
      if (!row.status) {
        issues.push({
          code: 'plan-missing-status',
          path: row.path,
          message: 'routed active plan is missing Status metadata',
        });
      }
      if (!hasLastVerified(row)) {
        issues.push({
          code: 'plan-missing-freshness',
          path: row.path,
          message: 'routed active plan is missing Last Verified Against metadata',
        });
      }
      if (!row.exitTrigger) {
        issues.push({
          code: 'plan-missing-exit-trigger',
          path: row.path,
          message: 'routed active plan is missing Exit Trigger metadata',
        });
      }
    }
  }

  return issues;
}

export function toPlanLifecycleMarkdown(report) {
  const lines = [];
  lines.push('# Plan Lifecycle Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Plan docs: ${report.counts.total}`);
  lines.push(`- Routed active entries: ${report.counts.routed}`);
  lines.push(`- Editable entries: ${report.counts.editable}`);
  lines.push(`- Archived entries: ${report.counts.archived}`);
  lines.push(`- Hard gate issues: ${report.hardGateIssues.length}`);
  lines.push('');

  if (report.hardGateIssues.length > 0) {
    lines.push('## Hard Gate Issues');
    lines.push('');
    for (const issue of report.hardGateIssues) {
      lines.push(`- [${issue.code}] ${issue.path} - ${issue.message}`);
    }
    lines.push('');
  }

  lines.push('## Plan Files');
  lines.push('');
  lines.push('| Kind | Status | Routed | Editable | Exit Trigger | Path |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of report.rows) {
    lines.push(
      `| ${row.kind} | ${row.status || ''} | ${row.routed} | ${row.editable} | ${row.exitTrigger || ''} | \`${row.path}\` |`,
    );
  }

  return lines.join('\n');
}

function collectPlanRouteSet({ repoRoot, config }) {
  const routeSource = config.docs_gardening?.plan_lifecycle?.route_source ?? DEFAULT_ROUTE_SOURCE;
  const content = readFileIfExists(path.join(repoRoot, routeSource));
  const routes = new Set();
  for (const match of content.matchAll(/docs\/plans\/[A-Za-z0-9_./-]+\.md/g)) {
    routes.add(match[0]);
  }
  return routes;
}

function collectMarkdownFiles(absRoot, relRoot) {
  if (!fs.existsSync(absRoot)) return [];
  const files = [];
  walk(absRoot, relRoot, files);
  return files;
}

function walk(absDir, relDir, files) {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const absPath = path.join(absDir, entry.name);
    const relPath = path.posix.join(relDir, entry.name);
    if (entry.isDirectory()) {
      walk(absPath, relPath, files);
      continue;
    }
    if (entry.isFile() && relPath.endsWith('.md')) {
      files.push(relPath);
    }
  }
}

function classifyPlanPath(relativePath) {
  if (relativePath === 'docs/plans/README.md') return 'router';
  if (relativePath.startsWith('docs/archive/plans/')) return 'archive';
  if (relativePath.startsWith('docs/plans/completed/')) return 'completed';
  if (relativePath.startsWith('docs/plans/backlog/')) return 'backlog';
  if (path.posix.dirname(relativePath) === 'docs/plans') return 'standalone';
  if (path.posix.basename(relativePath) === 'README.md') return 'topic';
  return 'phase/detail';
}

function classifyEditability({ relativePath, kind, status, routed, config }) {
  if (!relativePath.startsWith('docs/plans/')) return 'no';
  if (relativePath === 'docs/plans/README.md') return 'yes';
  if (!getAllowedStatuses(config).has(status)) return 'no';
  if (COMPLETED_STATUSES.has(status)) return 'no';
  if (!['topic', 'standalone', 'backlog'].includes(kind)) return 'no';
  return routed === 'yes' ? 'yes' : 'no';
}

function requiresActiveMetadata(row) {
  return ['topic', 'standalone', 'backlog'].includes(row.kind);
}

function hasLastVerified(row) {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(row.lastVerified);
}

function getAllowedStatuses(config) {
  return new Set(
    config.docs_gardening?.plan_lifecycle?.allowed_active_statuses ?? DEFAULT_ACTIVE_STATUSES,
  );
}

function readFileIfExists(absPath) {
  return fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
}

function readMarkdownTitle(content, fallback) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

function readMetaField(content, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^-\\s+${escaped}:\\s*(.+)$`, 'm').exec(content);
  return match?.[1] ?? '';
}

function normalizeStatus(value) {
  return value
    .trim()
    .replace(/^`|`\.?$/g, '')
    .replace(/\.$/g, '')
    .trim()
    .toLowerCase();
}

function normalizeMetaText(value) {
  return value
    .trim()
    .replace(/^`|`\.?$/g, '')
    .replace(/\.$/g, '')
    .trim();
}

function inferStatus(relativePath) {
  if (relativePath.startsWith('docs/archive/plans/')) return 'archived';
  if (relativePath.startsWith('docs/plans/completed/')) return 'completed';
  return '';
}

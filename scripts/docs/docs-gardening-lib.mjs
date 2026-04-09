#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { loadDocsCheckConfig, runDocsChecks } from './docs-check-lib.mjs';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_STALE_CANDIDATES = 40;
const MAX_ISSUE_FINDINGS = 8;

const PRIORITY_RANK = {
  P1: 3,
  P2: 2,
  P3: 1,
};

const CONFIDENCE_RANK = {
  high: 3,
  medium: 2,
  low: 1,
};

function buildDocsChecks({ repoRoot = process.cwd(), config } = {}) {
  const resolvedConfig = config ?? loadDocsCheckConfig(repoRoot);
  const core = runDocsChecks('core', { repoRoot, config: resolvedConfig });
  const ops = runDocsChecks('ops', { repoRoot, config: resolvedConfig });
  const nonCore = runDocsChecks('non_core', { repoRoot, config: resolvedConfig });

  return {
    core,
    ops,
    non_core: nonCore,
    metrics: {
      checkedDocs: core.docsChecked + ops.docsChecked + nonCore.docsChecked,
      errors: core.errors.length + ops.errors.length + nonCore.errors.length,
      warnings: core.warnings.length + ops.warnings.length + nonCore.warnings.length,
    },
  };
}

export function buildDocsHealthReport({
  repoRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  config,
} = {}) {
  const checks = buildDocsChecks({ repoRoot, config });
  return {
    generatedAt,
    metrics: checks.metrics,
    checks: {
      core: checks.core,
      ops: checks.ops,
      non_core: checks.non_core,
    },
    scoring: buildHealthScorecard(checks),
  };
}

export function writeDocsHealthReportArtifacts(
  report,
  { repoRoot = process.cwd(), outDir = path.join(repoRoot, 'tmp') } = {},
) {
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, 'docs-health-report.json');
  const mdPath = path.join(outDir, 'docs-health-report.md');

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, `${toDocsHealthMarkdown(report)}\n`, 'utf8');

  return { jsonPath, mdPath };
}

export function buildStaleActiveReport({
  repoRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  now = new Date(),
  config,
} = {}) {
  const resolvedConfig = config ?? loadDocsCheckConfig(repoRoot);
  const gardening = resolvedConfig.docs_gardening ?? {};
  const routeSources = gardening.route_sources ?? [];
  const routeContents = routeSources
    .filter((file) => fs.existsSync(path.join(repoRoot, file)))
    .map((file) => ({
      file,
      content: fs.readFileSync(path.join(repoRoot, file), 'utf8'),
    }));

  const markdownFiles = collectMarkdownFiles({ repoRoot, config: resolvedConfig });
  const docIndex = markdownFiles.map((relPath) => ({
    path: relPath,
    lastCommitDate: readLastCommitDate({ repoRoot, relPath }),
    stemTokens: tokenizeStem(relPath),
  }));

  const candidates = [];
  const reasonCounts = {};

  for (const relPath of markdownFiles) {
    const currentDoc = docIndex.find((item) => item.path === relPath);
    const lastCommitDate = currentDoc?.lastCommitDate ?? null;
    if (!lastCommitDate) continue;

    const daysOld = Math.floor((now.getTime() - lastCommitDate.getTime()) / MS_PER_DAY);
    const inboundRefs = countInboundRefs({ relPath, routeContents });
    const overlapWithNewer = findOverlappingNewerDocs(currentDoc, docIndex);
    const content = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
    const stalePathRefs = countMatchesInContent(content, [
      /\]\(configs\//g,
      /`configs\//g,
      /file:\/\//g,
    ]);

    const reasons = [];
    let score = 0;

    if (daysOld >= 45) {
      score += 1;
      reasons.push('stale-by-age');
    }
    if (daysOld >= 75) {
      score += 1;
      reasons.push('stale-by-age-75');
    }
    if (daysOld >= 120) {
      score += 1;
      reasons.push('stale-by-age-120');
    }
    if (inboundRefs === 0) {
      score += 2;
      reasons.push('no-route-coverage');
    }
    if (stalePathRefs > 0) {
      score += stalePathRefs * 2;
      reasons.push('stale-path-ref');
    }
    if (overlapWithNewer.length > 0) {
      score += Math.min(2, overlapWithNewer.length);
      reasons.push('overlap-with-newer-doc');
    }

    if (score === 0) continue;

    for (const reason of reasons) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }

    const priority = classifyPriority({ relPath, config: resolvedConfig });
    const confidence = classifyConfidence({
      daysOld,
      inboundRefs,
      stalePathRefs,
      overlapWithNewerCount: overlapWithNewer.length,
      priority,
      score,
    });

    candidates.push({
      path: relPath,
      priority,
      confidence,
      daysOld,
      inboundRefs,
      stalePathRefs,
      overlapWithNewerCount: overlapWithNewer.length,
      overlapWithNewerExamples: overlapWithNewer.slice(0, 3).map((item) => item.path),
      score,
      reasons,
      lastCommitDate: formatDate(lastCommitDate),
    });
  }

  candidates.sort(
    (left, right) =>
      PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority] ||
      CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence] ||
      right.score - left.score ||
      right.daysOld - left.daysOld ||
      left.path.localeCompare(right.path),
  );

  const countsByPriority = candidates.reduce(
    (acc, candidate) => {
      acc[candidate.priority] += 1;
      return acc;
    },
    { P1: 0, P2: 0, P3: 0 },
  );

  return {
    generatedAt,
    totalCandidates: candidates.length,
    countsByPriority,
    reasonCounts,
    topCandidates: candidates.slice(0, MAX_STALE_CANDIDATES),
  };
}

export function writeStaleActiveArtifacts(
  report,
  { repoRoot = process.cwd(), outDir = path.join(repoRoot, 'tmp') } = {},
) {
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, 'docs-stale-active.json');
  const mdPath = path.join(outDir, 'docs-stale-active.md');

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, `${toStaleActiveMarkdown(report)}\n`, 'utf8');

  return { jsonPath, mdPath };
}

export function buildDocsGardeningReport({
  repoRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  now = new Date(),
  config,
} = {}) {
  const resolvedConfig = config ?? loadDocsCheckConfig(repoRoot);
  const checks = buildDocsChecks({ repoRoot, config: resolvedConfig });
  const health = buildHealthScorecard(checks);
  const staleActive = buildStaleActiveReport({
    repoRoot,
    generatedAt,
    now,
    config: resolvedConfig,
  });

  return composeDocsGardeningSnapshot({
    generatedAt,
    checks,
    health,
    staleActive,
    config: resolvedConfig,
  });
}

export function composeDocsGardeningSnapshot({
  generatedAt = new Date().toISOString(),
  checks,
  health,
  staleActive,
  config = {},
}) {
  const hardGateItems = collectGateItems(checks);
  const warningItems = collectWarningItems(checks);
  const manualReviewQueue = buildManualReviewQueue({
    generatedAt,
    staleActive,
    config,
  });
  const summary = buildSummary({
    hardGateItems,
    warningItems,
    staleActive,
    manualReviewQueue,
  });
  const issue = buildRollingIssue({
    generatedAt,
    summary,
    hardGateItems,
    warningItems,
    manualReviewQueue,
    health,
    staleActive,
    config,
  });

  return {
    generatedAt,
    summary,
    metrics: checks.metrics,
    checks: {
      core: checks.core,
      ops: checks.ops,
      non_core: checks.non_core,
    },
    hardGates: {
      passed: hardGateItems.length === 0,
      count: hardGateItems.length,
      items: hardGateItems,
    },
    warnings: {
      count: warningItems.length,
      items: warningItems,
    },
    heuristics: {
      health,
      staleActive,
    },
    manualReviewQueue: {
      count: manualReviewQueue.length,
      items: manualReviewQueue,
    },
    issue,
  };
}

export function writeDocsGardeningArtifacts(
  report,
  { repoRoot = process.cwd(), outDir = path.join(repoRoot, 'tmp') } = {},
) {
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, 'docs-gardening.json');
  const issueJsonPath = path.join(outDir, 'docs-gardening-issue.json');
  const issueMdPath = path.join(outDir, 'docs-gardening-issue.md');

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(issueJsonPath, `${JSON.stringify(report.issue, null, 2)}\n`, 'utf8');
  fs.writeFileSync(issueMdPath, `${report.issue.body.trimEnd()}\n`, 'utf8');

  return { jsonPath, issueJsonPath, issueMdPath };
}

function buildHealthScorecard(checks) {
  const routingPenalty = countMatches(checks.core.errors, [
    'missing-route-hint',
    'missing-route-doc',
  ]);
  const allErrors = [...checks.core.errors, ...checks.ops.errors, ...checks.non_core.errors];
  const authorityPenalty = countMatches(allErrors, ['missing-meta']);
  const freshnessPenalty = countMatches(allErrors, [
    'stale-doc',
    'missing-freshness',
    'invalid-freshness',
  ]);
  const enforcePenalty = checks.metrics.errors;
  const opsPenalty = checks.ops.errors.length + checks.non_core.errors.length;

  const routingClarity = clampScore(10 - routingPenalty * 1.5);
  const authorityClarity = clampScore(10 - authorityPenalty * 0.8);
  const freshness = clampScore(10 - freshnessPenalty * 1.2);
  const mechanical = clampScore(10 - enforcePenalty * 0.3);
  const opsReliability = clampScore(10 - opsPenalty * 0.7);
  const archiveHygiene = 8.8;
  const onboarding = clampScore((routingClarity + authorityClarity + freshness) / 3);

  const dimensions = {
    routing_clarity: routingClarity,
    authority_ownership_clarity: authorityClarity,
    freshness_drift_resistance: freshness,
    mechanical_enforceability: mechanical,
    ops_runbook_reliability: opsReliability,
    archive_hygiene: archiveHygiene,
    agent_onboarding_speed: onboarding,
  };

  const values = Object.values(dimensions);
  const composite = Number(
    (values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(2),
  );

  return {
    dimensions,
    composite,
  };
}

function collectGateItems(checks) {
  return [
    ...formatLines(checks.core.errors, 'core', 'gate'),
    ...formatLines(checks.ops.errors, 'ops', 'gate'),
    ...formatLines(checks.non_core.errors, 'non_core', 'gate'),
  ];
}

function collectWarningItems(checks) {
  return [
    ...formatLines(checks.core.warnings, 'core', 'warning'),
    ...formatLines(checks.ops.warnings, 'ops', 'warning'),
    ...formatLines(checks.non_core.warnings, 'non_core', 'warning'),
  ];
}

function formatLines(lines, scope, kind) {
  return lines.map((line) => {
    const parsed = parseBracketedLine(line);
    const path = extractPathFromMessage(parsed.message);
    return {
      kind,
      scope,
      code: parsed.code,
      message: parsed.message,
      path,
      raw: line,
    };
  });
}

function parseBracketedLine(line) {
  const match = /^\[(?<code>[^\]]+)\]\s*(?<message>.*)$/u.exec(line);
  return {
    code: match?.groups?.code ?? 'unknown',
    message: match?.groups?.message ?? line,
  };
}

function buildManualReviewQueue({ generatedAt, staleActive, config }) {
  const queue = [];
  const heuristicCandidates = [...(staleActive.topCandidates ?? [])]
    .filter((candidate) => candidate.priority !== 'P1')
    .sort(
      (left, right) =>
        CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence] ||
        PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority] ||
        right.score - left.score ||
        right.daysOld - left.daysOld ||
        left.path.localeCompare(right.path),
    )
    .slice(0, 2);

  for (const candidate of heuristicCandidates) {
    queue.push({
      kind: 'heuristic-candidate',
      path: candidate.path,
      priority: candidate.priority,
      confidence: candidate.confidence,
      summary: `${candidate.daysOld} days old; reasons: ${candidate.reasons.join(', ')}`,
      details: candidate,
    });
  }

  const goldenSet = config.docs_gardening?.golden_set_docs ?? [];
  if (goldenSet.length > 0) {
    const index = rotatingIndex({ generatedAt, length: goldenSet.length });
    queue.push({
      kind: 'golden-set-audit',
      path: goldenSet[index],
      priority: 'P1',
      confidence: 'high',
      summary: 'Rotate one authoritative doc through manual review each run.',
      details: {
        rotationIndex: index,
      },
    });
  }

  return queue;
}

function buildSummary({ hardGateItems, warningItems, staleActive, manualReviewQueue }) {
  const status =
    hardGateItems.length > 0
      ? 'failing'
      : warningItems.length > 0
        ? 'warnings'
        : staleActive.totalCandidates > 0
          ? 'review-suggested'
          : 'clean';

  return {
    status,
    hardGateCount: hardGateItems.length,
    warningCount: warningItems.length,
    staleCandidateCount: staleActive.totalCandidates,
    manualReviewCount: manualReviewQueue.length,
  };
}

function buildRollingIssue({
  generatedAt,
  summary,
  hardGateItems,
  warningItems,
  manualReviewQueue,
  health,
  staleActive,
  config,
}) {
  const action = summary.status === 'clean' ? 'close' : 'create-or-update';
  const title = config.docs_gardening?.rolling_issue_title ?? 'docs-gardening';

  return {
    action,
    title,
    status: summary.status,
    body: toRollingIssueMarkdown({
      generatedAt,
      summary,
      hardGateItems,
      warningItems,
      manualReviewQueue,
      health,
      staleActive,
    }),
  };
}

function collectMarkdownFiles({ repoRoot, config }) {
  const gardening = config.docs_gardening ?? {};
  const activeRoots = gardening.stale_scan_roots ?? ['docs'];
  const excludedPrefixes = gardening.stale_excluded_prefixes ?? ['docs/archive/'];
  const explicitIncludedDocs = [
    ...(config.non_core_docs ?? []).filter(
      (doc) => doc.startsWith('packages/') && doc.endsWith('.md'),
    ),
    ...(config.active_ops_docs ?? []).filter(
      (doc) => doc.startsWith('packages/') && doc.endsWith('.md'),
    ),
    ...(config.core_docs ?? []).filter((doc) => doc.startsWith('packages/') && doc.endsWith('.md')),
  ];

  const files = [];
  for (const root of activeRoots) {
    walk(root, files);
  }

  for (const relPath of explicitIncludedDocs) {
    if (excludedPrefixes.some((prefix) => relPath.startsWith(prefix))) continue;
    const absPath = path.join(repoRoot, relPath);
    if (fs.existsSync(absPath) && relPath.endsWith('.md')) {
      files.push(relPath);
    }
  }

  return [...new Set(files)].sort((a, b) => a.localeCompare(b));

  function walk(relDir, acc) {
    const absDir = path.join(repoRoot, relDir);
    if (!fs.existsSync(absDir)) return;

    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = path.posix.join(relDir.replaceAll('\\', '/'), entry.name);
      if (excludedPrefixes.some((prefix) => relPath.startsWith(prefix))) continue;

      if (entry.isDirectory()) {
        walk(relPath, acc);
        continue;
      }

      if (entry.isFile() && relPath.endsWith('.md')) {
        acc.push(relPath);
      }
    }
  }
}

function classifyPriority({ relPath, config }) {
  if (
    (config.core_docs ?? []).includes(relPath) ||
    (config.active_ops_docs ?? []).includes(relPath) ||
    (config.non_core_docs ?? []).includes(relPath)
  ) {
    return 'P1';
  }

  if (
    (config.docs_gardening?.low_signal_prefixes ?? []).some((prefix) => relPath.startsWith(prefix))
  ) {
    return 'P3';
  }

  return 'P2';
}

function classifyConfidence({
  daysOld,
  inboundRefs,
  stalePathRefs,
  overlapWithNewerCount,
  priority,
  score,
}) {
  if (stalePathRefs > 0) return 'high';
  if (overlapWithNewerCount > 0 && inboundRefs === 0) return 'high';
  if (daysOld >= 120 && inboundRefs === 0) return 'high';
  if (priority === 'P1' && score >= 3) return 'medium';
  if (score >= 4) return 'medium';
  return 'low';
}

function readLastCommitDate({ repoRoot, relPath }) {
  try {
    const output = execSync(`git log -1 --date=short --pretty=format:%cs -- ${quote(relPath)}`, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();

    if (!output) return null;
    const parsed = new Date(`${output}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function countInboundRefs({ relPath, routeContents }) {
  const base = path.basename(relPath);
  let count = 0;

  for (const route of routeContents) {
    if (route.content.includes(relPath)) count += 1;
    if (route.content.includes(base)) count += 1;
  }

  return count;
}

function countMatchesInContent(content, patterns) {
  let total = 0;
  for (const pattern of patterns) {
    total += (content.match(pattern) ?? []).length;
  }
  return total;
}

function findOverlappingNewerDocs(currentDoc, allDocs) {
  if (!currentDoc?.lastCommitDate || currentDoc.stemTokens.size === 0) return [];

  const threshold = currentDoc.lastCommitDate.getTime() + 7 * 24 * 60 * 60 * 1000;
  const matches = [];

  for (const doc of allDocs) {
    if (doc.path === currentDoc.path) continue;
    if (!doc.lastCommitDate) continue;
    if (doc.lastCommitDate.getTime() <= threshold) continue;
    if (doc.stemTokens.size === 0) continue;

    const overlap = countTokenOverlap(currentDoc.stemTokens, doc.stemTokens);
    if (overlap < 2) continue;

    const union = new Set([...currentDoc.stemTokens, ...doc.stemTokens]).size;
    const similarity = overlap / union;
    if (similarity < 0.4) continue;

    matches.push({
      path: doc.path,
      overlap,
      similarity,
      lastCommitDate: doc.lastCommitDate,
    });
  }

  return matches.sort(
    (a, b) =>
      b.similarity - a.similarity ||
      b.overlap - a.overlap ||
      b.lastCommitDate.getTime() - a.lastCommitDate.getTime() ||
      a.path.localeCompare(b.path),
  );
}

function countTokenOverlap(left, right) {
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap;
}

function tokenizeStem(relPath) {
  const stem = path.basename(relPath, '.md').toLowerCase();
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'into',
    'guide',
    'spec',
    'docs',
    'doc',
    'readme',
  ]);

  const tokens = stem
    .split(/[-_]/g)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 3 && !stopWords.has(token));
  return new Set(tokens);
}

function rotatingIndex({ generatedAt, length }) {
  if (length <= 1) return 0;
  const date = new Date(generatedAt);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const daysSinceYearStart = Math.floor((date.getTime() - yearStart) / MS_PER_DAY);
  return Math.floor(daysSinceYearStart / 7) % length;
}

function extractPathFromMessage(message) {
  const match = /\b(?<path>(?:AGENTS|docs|packages)\/[^\s:]+(?:\.[a-z]+)?)/u.exec(message);
  return match?.groups?.path ?? null;
}

function countMatches(lines, patterns) {
  return lines.filter((line) => patterns.some((pattern) => line.includes(pattern))).length;
}

function clampScore(value) {
  if (value < 0) return 0;
  if (value > 10) return 10;
  return Number(value.toFixed(2));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function toDocsHealthMarkdown(report) {
  const { generatedAt, metrics, checks, scoring } = report;
  const lines = [];

  lines.push('# Docs Health Report');
  lines.push('');
  lines.push(`- Generated at: ${generatedAt}`);
  lines.push(`- Checked docs: ${metrics.checkedDocs}`);
  lines.push(`- Errors: ${metrics.errors}`);
  lines.push(`- Warnings: ${metrics.warnings}`);
  lines.push('');
  lines.push('## Scorecard');
  lines.push('');
  lines.push('| Dimension | Score |');
  lines.push('| --- | --- |');

  for (const [dimension, score] of Object.entries(scoring.dimensions)) {
    lines.push(`| ${dimension} | ${score} |`);
  }

  lines.push(`| composite | ${scoring.composite} |`);
  lines.push('');

  appendScope(lines, 'Core', checks.core);
  appendScope(lines, 'Ops', checks.ops);
  appendScope(lines, 'Non-Core', checks.non_core);

  return lines.join('\n');
}

function appendScope(lines, label, result) {
  lines.push(`## ${label} Check`);
  lines.push('');
  lines.push(`- Docs checked: ${result.docsChecked}`);
  lines.push(`- Errors: ${result.errors.length}`);
  lines.push(`- Warnings: ${result.warnings.length}`);
  lines.push('');
  appendList(lines, result.errors, `${label} errors`);
  appendList(lines, result.warnings, `${label} warnings`);
}

function appendList(lines, items, title) {
  lines.push(`### ${title}`);
  lines.push('');
  if (items.length === 0) {
    lines.push('- none');
    lines.push('');
    return;
  }

  for (const item of items) {
    lines.push(`- ${item}`);
  }
  lines.push('');
}

function toStaleActiveMarkdown(report) {
  const lines = [];
  lines.push('# Stale Active Docs Candidates');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Candidate count: ${report.totalCandidates}`);
  lines.push(`- P1 candidates: ${report.countsByPriority.P1}`);
  lines.push(`- P2 candidates: ${report.countsByPriority.P2}`);
  lines.push(`- P3 candidates: ${report.countsByPriority.P3}`);
  lines.push('');

  if (report.topCandidates.length === 0) {
    lines.push('- No stale candidates detected by current heuristics.');
    return lines.join('\n');
  }

  lines.push('| Path | Priority | Confidence | Score | Days Old | Reasons | Last Commit |');
  lines.push('| --- | --- | --- | ---: | ---: | --- | --- |');

  for (const item of report.topCandidates) {
    lines.push(
      `| ${item.path} | ${item.priority} | ${item.confidence} | ${item.score} | ${item.daysOld} | ${item.reasons.join(', ')} | ${item.lastCommitDate} |`,
    );
  }

  lines.push('');
  lines.push('Heuristic only: review manually before archive or reroute decisions.');
  return lines.join('\n');
}

function toRollingIssueMarkdown({
  generatedAt,
  summary,
  hardGateItems,
  warningItems,
  manualReviewQueue,
  health,
  staleActive,
}) {
  const lines = [];
  lines.push('# Docs Gardening');
  lines.push('');
  lines.push(`- Status: **${summary.status}**`);
  lines.push(`- Generated at: ${generatedAt}`);
  lines.push(`- Hard gate errors: ${summary.hardGateCount}`);
  lines.push(`- Warnings: ${summary.warningCount}`);
  lines.push(`- Stale candidates: ${summary.staleCandidateCount}`);
  lines.push(`- Review this week: ${summary.manualReviewCount}`);
  lines.push(`- Health composite: ${health.composite}`);
  lines.push('');

  if (summary.status === 'clean') {
    lines.push('No current docs-gardening action required.');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## This Week');
  lines.push('');
  if (summary.status === 'failing') {
    lines.push('- Fix hard gate failures first.');
  } else if (summary.status === 'warnings') {
    lines.push('- Review warnings and promote repeated drift into checks when warranted.');
  } else {
    lines.push('- No hard failures. Review the heuristic queue and rotate one golden-set doc.');
  }
  lines.push('- Re-run `pnpm docs:check && pnpm docs:garden` locally after fixes.');
  lines.push('');

  if (hardGateItems.length > 0) {
    lines.push('## Hard Gate Findings');
    lines.push('');
    for (const item of hardGateItems.slice(0, MAX_ISSUE_FINDINGS)) {
      lines.push(`- [${item.scope}] \`${item.code}\` ${item.message}`);
    }
    lines.push('');
  }

  if (warningItems.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const item of warningItems.slice(0, MAX_ISSUE_FINDINGS)) {
      lines.push(`- [${item.scope}] \`${item.code}\` ${item.message}`);
    }
    lines.push('');
  }

  if (manualReviewQueue.length > 0) {
    lines.push('## Review This Week');
    lines.push('');
    for (const item of manualReviewQueue) {
      lines.push(`- [${item.kind}] ${item.path} — ${item.summary}`);
    }
    lines.push('');
  }

  if (staleActive.topCandidates.length > 0) {
    lines.push('## Top Heuristic Candidates');
    lines.push('');
    for (const item of staleActive.topCandidates.slice(0, 5)) {
      lines.push(
        `- [${item.priority}/${item.confidence}] ${item.path} — score ${item.score}; reasons: ${item.reasons.join(', ')}`,
      );
    }
    lines.push('');
  }

  lines.push('## Artifacts');
  lines.push('');
  lines.push('- `tmp/docs-gardening.json`');
  lines.push('- `tmp/docs-gardening-issue.json`');
  lines.push('- `tmp/docs-health-report.md`');
  lines.push('- `tmp/docs-stale-active.md`');
  lines.push('');
  return lines.join('\n');
}

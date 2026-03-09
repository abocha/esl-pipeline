#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = process.cwd();
const now = new Date();

const activeRoots = [
  'docs',
];

const explicitIncludedDocs = [
  'packages/orchestrator/README.md',
  'packages/batch-backend/README.md',
  'packages/batch-frontend/README.md',
  'packages/provider-runtime/README.md',
];

const excludedPrefixes = [
  'docs/archive/',
  'docs/drafts/',
  'docs/templates/',
  'docs/plans/',
];

const routeSources = [
  'AGENTS.md',
  'docs/README.md',
  'docs/reference/DOCS_IA_MAP.md',
  'docs/reference/DOCS_GOVERNANCE.md',
];

const routeContents = routeSources
  .filter((file) => fs.existsSync(path.join(repoRoot, file)))
  .map((file) => ({
    file,
    content: fs.readFileSync(path.join(repoRoot, file), 'utf8'),
  }));

const markdownFiles = collectMarkdownFiles();
const docIndex = markdownFiles.map((relPath) => {
  const lastCommitDate = readLastCommitDate(relPath);
  return {
    path: relPath,
    lastCommitDate,
    stemTokens: tokenizeStem(relPath),
  };
});

const candidates = [];
for (const relPath of markdownFiles) {
  const currentDoc = docIndex.find((item) => item.path === relPath);
  const lastCommitDate = currentDoc?.lastCommitDate ?? null;
  if (!lastCommitDate) continue;

  const daysOld = Math.floor((now.getTime() - lastCommitDate.getTime()) / (24 * 60 * 60 * 1000));
  const inboundRefs = countInboundRefs(relPath);
  const overlapWithNewer = findOverlappingNewerDocs(currentDoc, docIndex);

  const content = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  const stalePathRefs = countMatches(content, [
    /\]\(configs\//g,
    /`configs\//g,
    /file:\/\//g,
  ]);

  let score = 0;
  if (daysOld >= 45) score += 1;
  if (daysOld >= 75) score += 1;
  if (daysOld >= 120) score += 1;
  if (inboundRefs === 0) score += 2;
  if (stalePathRefs > 0) score += stalePathRefs * 2;
  if (overlapWithNewer.length > 0) score += Math.min(2, overlapWithNewer.length);

  if (score === 0) continue;

  candidates.push({
    path: relPath,
    daysOld,
    inboundRefs,
    stalePathRefs,
    overlapWithNewerCount: overlapWithNewer.length,
    overlapWithNewerExamples: overlapWithNewer.slice(0, 3).map((item) => item.path),
    score,
    lastCommitDate: formatDate(lastCommitDate),
  });
}

candidates.sort((a, b) => b.score - a.score || b.daysOld - a.daysOld || a.path.localeCompare(b.path));

const result = {
  generatedAt: new Date().toISOString(),
  totalCandidates: candidates.length,
  topCandidates: candidates.slice(0, 40),
};

const outDir = path.join(repoRoot, 'tmp');
fs.mkdirSync(outDir, { recursive: true });

const jsonPath = path.join(outDir, 'docs-stale-active.json');
const mdPath = path.join(outDir, 'docs-stale-active.md');

fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
fs.writeFileSync(mdPath, toMarkdown(result), 'utf8');

console.log(`stale active docs report written:\n- ${jsonPath}\n- ${mdPath}`);

function collectMarkdownFiles() {
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
}

function walk(relDir, files) {
  const absDir = path.join(repoRoot, relDir);
  if (!fs.existsSync(absDir)) return;

  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = path.posix.join(relDir.replaceAll('\\', '/'), entry.name);
    if (excludedPrefixes.some((prefix) => relPath.startsWith(prefix))) continue;

    if (entry.isDirectory()) {
      walk(relPath, files);
      continue;
    }

    if (entry.isFile() && relPath.endsWith('.md')) {
      files.push(relPath);
    }
  }
}

function readLastCommitDate(relPath) {
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

function countInboundRefs(relPath) {
  const base = path.basename(relPath);
  let count = 0;

  for (const route of routeContents) {
    if (route.content.includes(relPath)) count += 1;
    if (route.content.includes(base)) count += 1;
  }

  return count;
}

function countMatches(content, patterns) {
  let total = 0;
  for (const pattern of patterns) {
    total += (content.match(pattern) ?? []).length;
  }
  return total;
}

function findOverlappingNewerDocs(currentDoc, allDocs) {
  if (!currentDoc?.lastCommitDate || currentDoc.stemTokens.size === 0) return [];

  const threshold = currentDoc.lastCommitDate.getTime() + (7 * 24 * 60 * 60 * 1000);
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

  return matches.sort((a, b) =>
    b.similarity - a.similarity ||
    b.overlap - a.overlap ||
    b.lastCommitDate.getTime() - a.lastCommitDate.getTime() ||
    a.path.localeCompare(b.path)
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

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function toMarkdown(result) {
  const lines = [];
  lines.push('# Stale Active Docs Candidates');
  lines.push('');
  lines.push(`- Generated at: ${result.generatedAt}`);
  lines.push(`- Candidate count: ${result.totalCandidates}`);
  lines.push('');

  if (result.topCandidates.length === 0) {
    lines.push('- No stale candidates detected by current heuristics.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('| Path | Score | Days Old | Inbound Refs | Stale Path Refs | Overlap With Newer | Last Commit |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- |');

  for (const item of result.topCandidates) {
    lines.push(`| ${item.path} | ${item.score} | ${item.daysOld} | ${item.inboundRefs} | ${item.stalePathRefs} | ${item.overlapWithNewerCount} | ${item.lastCommitDate} |`);
  }

  lines.push('');
  lines.push('Heuristic only: review manually before archive/move decisions.');
  return `${lines.join('\n')}\n`;
}

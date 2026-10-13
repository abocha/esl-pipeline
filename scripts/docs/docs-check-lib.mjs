#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { flattenChangedFileRecords, parseNameStatusZ } from '../check/workspace-change-scope.mjs';
import { buildPlanLifecycleReport } from './plan-lifecycle-lib.mjs';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function loadDocsCheckConfig(repoRoot = process.cwd()) {
  const configPath = path.join(repoRoot, 'scripts/docs/docs-check.config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

export function runDocsChecks(scope, options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const config = options.config ?? loadDocsCheckConfig(repoRoot);
  const freshnessMode = options.freshnessMode ?? 'full';
  if (!['full', 'pr'].includes(freshnessMode)) {
    throw new Error(`Unsupported docs freshness mode: ${freshnessMode}`);
  }
  const docs = resolveDocsForScope(scope, config);
  const errors = [];
  const warnings = [];

  for (const relPath of docs) {
    const absPath = path.join(repoRoot, relPath);
    if (!fs.existsSync(absPath)) {
      errors.push(`[missing-doc] ${relPath} does not exist`);
      continue;
    }

    const content = fs.readFileSync(absPath, 'utf8');
    validateBannedLiterals({ content, relPath, config, errors });
    validateLinks({ content, relPath, repoRoot, config, errors });
    validateMetadata({ content, relPath, config, errors });
    validateFreshness({
      content,
      relPath,
      config,
      scope,
      freshnessMode,
      now: options.now,
      errors,
      warnings,
    });
  }

  if (scope === 'core') {
    validateRouteHints({ repoRoot, config, errors });
  }
  if (scope === 'non_core') {
    validatePlanLifecycle({ repoRoot, config, errors });
  }

  return {
    scope,
    docsChecked: docs.length,
    errors,
    warnings,
  };
}

export function readChangedFiles({ repoRoot = process.cwd(), from, to } = {}) {
  if (!from || !to) throw new Error('Both from and to revisions are required');

  const output = execFileSync(
    'git',
    [
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      '--find-copies',
      '--diff-filter=ACDMRTUXB',
      `${from}...${to}`,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const changedFiles = flattenChangedFileRecords(parseNameStatusZ(output));
  if (changedFiles.length === 0) throw new Error(`committed diff ${from}...${to} is empty`);
  return changedFiles;
}

function validatePlanLifecycle({ repoRoot, config, errors }) {
  const report = buildPlanLifecycleReport({ repoRoot, config });
  for (const issue of report.hardGateIssues) {
    errors.push(`[plan-lifecycle] ${issue.path} ${issue.message}`);
  }
}

export function formatCheckResult(result) {
  const lines = [];
  if (result.errors.length > 0) {
    lines.push(`${result.scope} docs check failed (${result.errors.length} errors)`);
    for (const error of result.errors) lines.push(`- ${error}`);
  } else {
    lines.push(`${result.scope} docs check passed (${result.docsChecked} docs)`);
  }

  if (result.warnings.length > 0) {
    lines.push(`${result.scope} docs warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }

  return lines.join('\n');
}

function resolveDocsForScope(scope, config) {
  const include =
    scope === 'core'
      ? (config.core_docs ?? [])
      : scope === 'ops'
        ? (config.active_ops_docs ?? [])
        : scope === 'non_core'
          ? (config.non_core_docs ?? [])
          : null;
  if (!include) throw new Error(`Unsupported docs check scope: ${scope}`);

  const excludedDocs = new Set(config.exclude_docs ?? []);
  const excludedPrefixes = config.exclude_prefixes ?? [];

  return include.filter((doc) => {
    if (excludedDocs.has(doc)) return false;
    return !excludedPrefixes.some((prefix) => doc.startsWith(prefix));
  });
}

function validateBannedLiterals({ content, relPath, config, errors }) {
  for (const literal of config.banned_literals ?? []) {
    if (content.includes(literal)) {
      errors.push(`[banned-pattern] ${relPath} contains forbidden pattern: ${literal}`);
    }
  }
}

function validateLinks({ content, relPath, repoRoot, config, errors }) {
  const linkRegex = /\[[^\]]+\]\(([^)]+)\)/g;

  for (const match of content.matchAll(linkRegex)) {
    const rawTarget = (match[1] ?? '').trim();
    if (!rawTarget) continue;
    const target = rawTarget.startsWith('<')
      ? (rawTarget.match(/^<([^>]*)>/u)?.[1] ?? rawTarget)
      : rawTarget.split(/\s+/)[0].replaceAll(/^<|>$/g, '');

    if (
      target.startsWith('http://') ||
      target.startsWith('https://') ||
      target.startsWith('mailto:') ||
      target.startsWith('#')
    ) {
      continue;
    }

    if (target.startsWith('file://')) {
      errors.push(`[forbidden-link] ${relPath} uses file:// link: ${target}`);
      continue;
    }

    const noFragment = decodeLinkTarget(target.split('#')[0]);
    if (!noFragment) continue;

    const docDir = path.dirname(path.join(repoRoot, relPath));
    const withoutLineRef = noFragment.replace(/:(\d+)(?::\d+)?$/, '');

    if (
      linkExists({ docDir, repoRoot, rawTarget: noFragment, config }) ||
      (withoutLineRef !== noFragment &&
        linkExists({ docDir, repoRoot, rawTarget: withoutLineRef, config }))
    ) {
      continue;
    }

    errors.push(`[broken-link] ${relPath} -> ${target}`);
  }
}

function decodeLinkTarget(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function linkExists({ docDir, repoRoot, rawTarget, config }) {
  const normalizedTarget = stripLeadingSlash(rawTarget);
  if ((config.allowed_missing_targets ?? []).includes(normalizedTarget)) {
    return true;
  }

  if (rawTarget.startsWith('/')) {
    return fs.existsSync(path.join(repoRoot, normalizedTarget));
  }

  const docRelative = path.resolve(docDir, rawTarget);
  if (fs.existsSync(docRelative)) return true;

  const repoRelative = path.resolve(repoRoot, rawTarget);
  return fs.existsSync(repoRelative);
}

function validateMetadata({ content, relPath, config, errors }) {
  if (!(config.meta_required_docs ?? []).includes(relPath)) return;

  for (const field of config.meta_required_fields ?? []) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^-\\s+${escaped}:`, 'm');
    if (!pattern.test(content)) {
      errors.push(`[missing-meta] ${relPath} is missing '${field}' in Meta section`);
    }
  }
}

function validateFreshness({
  content,
  relPath,
  config,
  scope,
  freshnessMode,
  now = new Date(),
  errors,
  warnings,
}) {
  if (!(config.meta_required_docs ?? []).includes(relPath)) return;

  const match = content.match(/Last Verified Against:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  if (!match?.[1]) {
    errors.push(`[missing-freshness] ${relPath} is missing ISO date for Last Verified Against`);
    return;
  }

  const verifiedDate = new Date(`${match[1]}T00:00:00.000Z`);
  if (Number.isNaN(verifiedDate.getTime())) {
    errors.push(`[invalid-freshness] ${relPath} has invalid Last Verified date '${match[1]}'`);
    return;
  }

  const daysOld = Math.floor((now.getTime() - verifiedDate.getTime()) / MS_PER_DAY);

  const threshold =
    scope === 'core'
      ? config.freshness_days?.core
      : scope === 'ops'
        ? config.freshness_days?.ops
        : scope === 'non_core'
          ? config.freshness_days?.non_core
          : undefined;
  if (typeof threshold === 'number' && daysOld > threshold) {
    if (freshnessMode === 'pr') {
      warnings.push(`[stale-doc-age-only] ${relPath} is ${daysOld} days old (max ${threshold})`);
      return;
    }
    errors.push(`[stale-doc] ${relPath} is ${daysOld} days old (max ${threshold})`);
    return;
  }

  if (relPath === 'docs/reference/agents-ssot.md') {
    const warnThreshold = config.freshness_days?.ssot_warning;
    if (typeof warnThreshold === 'number' && daysOld > warnThreshold) {
      warnings.push(`[stale-warning] ${relPath} is ${daysOld} days old (warn > ${warnThreshold})`);
    }
  }
}

function validateRouteHints({ repoRoot, config, errors }) {
  for (const route of config.required_route_hints ?? []) {
    const absPath = path.join(repoRoot, route.file);
    if (!fs.existsSync(absPath)) {
      errors.push(`[missing-route-doc] ${route.file} does not exist`);
      continue;
    }

    const content = fs.readFileSync(absPath, 'utf8');
    for (const hint of route.hints ?? []) {
      if (!content.includes(hint)) {
        errors.push(`[missing-route-hint] ${route.file} should reference '${hint}'`);
      }
    }
  }
}

function stripLeadingSlash(value) {
  return value.startsWith('/') ? value.slice(1) : value;
}

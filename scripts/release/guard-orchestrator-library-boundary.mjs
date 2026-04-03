#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

function runGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function tryGit(args) {
  try {
    return runGit(args);
  } catch {
    return null;
  }
}

function readJson(relPath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relPath), 'utf8'));
}

function collectTsFiles(dirPath, out = []) {
  if (!existsSync(dirPath)) return out;
  for (const name of readdirSync(dirPath, { withFileTypes: true })) {
    const absolute = path.join(dirPath, name.name);
    if (name.isDirectory()) {
      collectTsFiles(absolute, out);
      continue;
    }
    if (name.isFile() && (absolute.endsWith('.ts') || absolute.endsWith('.tsx'))) {
      out.push(absolute);
    }
  }
  return out;
}

function addDiffOutput(changed, diffOutput) {
  if (diffOutput === null) return;
  for (const line of diffOutput.split('\n')) {
    const filePath = line.trim();
    if (filePath) changed.add(filePath);
  }
}

function resolveChangedFiles() {
  const changed = new Set();
  const eventName = process.env.GITHUB_EVENT_NAME;
  const baseRef = process.env.GITHUB_BASE_REF;
  let hasBaseDiff = false;

  if (eventName === 'pull_request' && baseRef) {
    const remoteBase = `origin/${baseRef}`;
    if (!tryGit(['rev-parse', '--verify', remoteBase])) {
      tryGit(['fetch', '--depth=1', 'origin', baseRef]);
    }
    if (tryGit(['rev-parse', '--verify', remoteBase])) {
      addDiffOutput(changed, tryGit(['diff', '--name-only', `${remoteBase}...HEAD`]));
      hasBaseDiff = true;
    }
  }

  if (!hasBaseDiff) {
    const explicitBase = process.env.GUARD_ORCHESTRATOR_BASE_REF?.trim();
    const baseCandidates = explicitBase ? [explicitBase] : ['origin/main', 'main'];

    for (const candidate of baseCandidates) {
      if (!candidate) continue;
      if (!tryGit(['rev-parse', '--verify', candidate])) continue;
      addDiffOutput(changed, tryGit(['diff', '--name-only', `${candidate}...HEAD`]));
      hasBaseDiff = true;
      break;
    }
  }

  // Always include local pending edits in guard evaluation.
  addDiffOutput(changed, tryGit(['diff', '--name-only', '--cached']));
  addDiffOutput(changed, tryGit(['diff', '--name-only', 'HEAD']));

  return Array.from(changed);
}

function includesAny(paths, prefixes) {
  return paths.some((filePath) =>
    prefixes.some((prefix) => filePath === prefix || filePath.startsWith(`${prefix}/`)),
  );
}

function main() {
  const findings = [];

  const rootPackageJson = readJson('package.json');
  const orchestratorPackageJson = readJson('packages/orchestrator/package.json');

  if (rootPackageJson.scripts?.esl) {
    findings.push('Root package.json must not define an `esl` CLI script.');
  }

  if (orchestratorPackageJson.bin) {
    findings.push('Orchestrator package must not define a `bin` entrypoint.');
  }

  const orchestrationRuntimeDeps = [
    '@esl-pipeline/batch-backend',
    'bullmq',
    'ioredis',
    'pg',
    'pino',
  ];
  const depSets = [
    orchestratorPackageJson.dependencies ?? {},
    orchestratorPackageJson.devDependencies ?? {},
  ];
  for (const depName of orchestrationRuntimeDeps) {
    if (depSets.some((deps) => depName in deps)) {
      findings.push(
        `Orchestrator package must stay runtime-agnostic; remove disallowed dependency \`${depName}\`.`,
      );
    }
  }

  const removedCliArtifacts = [
    'packages/orchestrator/bin/cli.ts',
    'packages/orchestrator/src/wizard.ts',
    'packages/orchestrator/src/pathPicker.ts',
    'packages/orchestrator/tests/wizard.test.ts',
    'packages/orchestrator/tests/pathPicker.test.ts',
  ];
  for (const relPath of removedCliArtifacts) {
    if (existsSync(path.join(repoRoot, relPath))) {
      findings.push(`Removed CLI artifact reintroduced: ${relPath}`);
    }
  }

  const tsupPath = path.join(repoRoot, 'packages/orchestrator/tsup.config.ts');
  const tsupSource = readFileSync(tsupPath, 'utf8');
  if (/entry\s*:\s*\{[\s\S]*\bcli\s*:/m.test(tsupSource)) {
    findings.push('Orchestrator tsup config must not include a `cli` build entry.');
  }

  const orchestratorSourceFiles = collectTsFiles(path.join(repoRoot, 'packages/orchestrator/src'));
  const forbiddenSourcePatterns = [
    { re: /from\s+['"]node:child_process['"]/u, message: 'node:child_process import' },
    { re: /from\s+['"]node:worker_threads['"]/u, message: 'node:worker_threads import' },
    { re: /from\s+['"]node:cluster['"]/u, message: 'node:cluster import' },
    { re: /BATCH_BACKEND_/u, message: 'BATCH_BACKEND_ env coupling' },
    {
      re: /newAssignmentViaV2|rerunAssignmentViaV2|getAssignmentStatusViaV2|planRerunAssignmentViaV2/u,
      message: 'transitional v2 compatibility adapters',
    },
  ];

  for (const absolutePath of orchestratorSourceFiles) {
    const source = readFileSync(absolutePath, 'utf8');
    for (const pattern of forbiddenSourcePatterns) {
      if (pattern.re.test(source)) {
        const relPath = path.relative(repoRoot, absolutePath);
        findings.push(`Forbidden orchestrator boundary pattern (${pattern.message}) in ${relPath}`);
      }
    }
  }

  const changedFiles = resolveChangedFiles();
  if (changedFiles.length > 0) {
    const contractSensitivePaths = [
      'packages/orchestrator/src/index.ts',
      'packages/orchestrator/src/types.ts',
      'packages/orchestrator/src/api-v2.ts',
      'packages/orchestrator/src/pipeline.ts',
      'packages/orchestrator/src/manifest.ts',
      'packages/batch-backend/src/infrastructure/orchestrator-service.ts',
      'packages/batch-backend/src/infrastructure/pipeline-worker-entry.ts',
      'packages/batch-backend/src/infrastructure/pipeline-worker-v2.ts',
    ];
    const docsSyncPaths = [
      'AGENTS.md',
      'README.md',
      'docs/PROJECT_OVERVIEW.md',
      'docs/QUICK_START.md',
      'docs/reference/env.md',
      'packages/orchestrator/README.md',
      'docs/reference/agents-ssot.md',
      'docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md',
      'docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md',
      'docs/reference/ORCHESTRATOR_API_V2_MIGRATION.md',
      'docs/backend-frontend/backend-frontend-alignment.md',
    ];

    const touchedContract = includesAny(changedFiles, contractSensitivePaths);
    const touchedDocs = includesAny(changedFiles, docsSyncPaths);

    if (touchedContract && !touchedDocs) {
      findings.push(
        'Contract-sensitive orchestrator/backend files changed without matching docs/SSOT updates.',
      );
    }
  }

  if (findings.length > 0) {
    console.error('[guard-orchestrator-library-boundary] FAILED');
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exit(1);
  }

  console.log('[guard-orchestrator-library-boundary] OK');
}

main();

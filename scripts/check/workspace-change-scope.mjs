import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const sharedImageAndToolchainFiles = new Set([
  '.gitignore',
  '.nvmrc',
  'biome.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'vitest.config.ts',
]);

export function parseNameStatusZ(value) {
  const tokens = String(value).split('\0');
  if (tokens.at(-1) === '') tokens.pop();

  const records = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++];
    if (!status) throw new Error('changed-file record is missing a status');
    if (!isValidChangedFileStatus(status)) {
      throw new Error(`invalid changed-file status: ${status}`);
    }

    const pathCount = /^[RC]/u.test(status) ? 2 : 1;
    const paths = tokens.slice(index, index + pathCount);
    if (paths.length !== pathCount || paths.some((file) => !file)) {
      throw new Error(`changed-file record ${status} is missing a path`);
    }
    index += pathCount;
    records.push({ status, paths: paths.map(normalizePath) });
  }
  return records;
}

export function flattenChangedFileRecords(records) {
  return uniqueSorted(records.flatMap((record) => record.paths).map(normalizePath));
}

export function buildCiScopeDecision({ changedFileRecords, workspacePackages }) {
  const changedFiles = flattenChangedFileRecords(changedFileRecords);
  const reasons = [];
  const addReason = (code, scope, subject) => reasons.push({ code, scope, subject });
  const blockingScopes = ['runtime', 'integration', 'backend_db_worker', 'telegram'];
  const decision = {
    runtime: false,
    integration: false,
    backend_db_worker: false,
    telegram: false,
    docs_only: false,
    maintenance_only: false,
    changedFiles,
    affectedPackages: [],
    reasons,
  };
  const enableAll = (code, subject) => {
    for (const scope of blockingScopes) decision[scope] = true;
    addReason(code, 'all', subject);
  };

  if (changedFiles.length === 0) {
    enableAll('empty-diff', 'no changed paths were reported');
    return stableCiDecision(decision);
  }

  decision.docs_only = changedFiles.every(isCiDocsPath);
  if (decision.docs_only) {
    addReason('docs-only', 'docs_only', changedFiles.join(','));
    return stableCiDecision(decision);
  }

  decision.maintenance_only = changedFiles.every(isCiMaintenanceOnlyPath);
  if (decision.maintenance_only) {
    addReason('repository-maintenance-only', 'maintenance_only', changedFiles.join(','));
    return stableCiDecision(decision);
  }

  const changedPackages = new Set();
  let conservativeFallback = false;
  for (const file of changedFiles) {
    const matchedPackage = findPackageForFile(file, workspacePackages);
    if (matchedPackage?.name) {
      changedPackages.add(matchedPackage.name);
    } else if (matchedPackage) {
      enableAll('untrusted-workspace-metadata', file);
      conservativeFallback = true;
      continue;
    }

    if (isCiRootToolchainPath(file)) {
      enableAll('root-toolchain', file);
      conservativeFallback = true;
    } else if (!matchedPackage && !isKnownCiNonPackagePath(file)) {
      enableAll('unknown-path', file);
      conservativeFallback = true;
    }
  }

  const affectedPackages = expandTransitiveDependents({
    packageNames: [...changedPackages],
    workspacePackages,
  });
  decision.affectedPackages = affectedPackages;

  if (
    !conservativeFallback &&
    (affectedPackages.length > 0 || changedFiles.some(isCiRuntimePath))
  ) {
    decision.runtime = true;
    decision.integration = true;
    decision.backend_db_worker = true;
    addReason('runtime-change', 'runtime', changedFiles.join(','));
    addReason('runtime-implies-integration', 'integration', 'runtime');
    addReason('runtime-implies-backend-db-worker', 'backend_db_worker', 'runtime');
  }

  if (
    !conservativeFallback &&
    (affectedPackages.includes('@esl-pipeline/telegram-ops-bot') ||
      changedFiles.some(isCiTelegramPath))
  ) {
    decision.telegram = true;
    addReason('telegram-change', 'telegram', changedFiles.join(','));
  }

  return stableCiDecision(decision);
}

export function expandTransitiveDependents({ packageNames, workspacePackages }) {
  const reverseDependencies = new Map();
  for (const workspacePackage of workspacePackages) {
    for (const dependency of workspacePackage.dependencies ?? []) {
      if (!reverseDependencies.has(dependency)) reverseDependencies.set(dependency, []);
      reverseDependencies.get(dependency).push(workspacePackage.name);
    }
  }

  const seen = new Set(packageNames);
  const queue = [...packageNames];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependent of reverseDependencies.get(current) ?? []) {
      if (!seen.has(dependent)) {
        seen.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return [...seen].sort();
}

export function readWorkspacePackages(repoRoot) {
  const workspaceFile = path.join(repoRoot, 'pnpm-workspace.yaml');
  const patterns = readWorkspacePatterns(workspaceFile);
  const packageDirs = new Set();

  for (const pattern of patterns) {
    for (const packageDir of expandWorkspacePattern(repoRoot, pattern)) {
      packageDirs.add(packageDir);
    }
  }

  const packageManifests = [...packageDirs]
    .sort()
    .map((dir) => readPackageManifest(dir))
    .filter(Boolean);
  const workspaceNames = new Set(packageManifests.map((manifest) => manifest.name));

  return packageManifests.map((manifest) => ({
    name: manifest.name,
    dir: normalizePath(path.relative(repoRoot, manifest.dir)),
    dependencies: uniqueSorted(
      [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ].filter((dependency) => workspaceNames.has(dependency)),
    ),
  }));
}

export function formatCiScopeGithubOutputs(decision) {
  return [
    'runtime',
    'integration',
    'backend_db_worker',
    'telegram',
    'docs_only',
    'maintenance_only',
  ]
    .map((scope) => `${scope}=${decision[scope] === true}`)
    .join('\n')
    .concat('\n');
}

export function formatCiScopeSummary(decision) {
  const scopes = [
    'runtime',
    'integration',
    'backend_db_worker',
    'telegram',
    'docs_only',
    'maintenance_only',
  ];
  return [
    '### Hosted CI scope',
    '',
    ...scopes.map((scope) => `- ${scope}: ${decision[scope] === true ? 'run' : 'skip'}`),
    '',
    `Changed files: ${decision.changedFiles?.length ?? 0}`,
    ...(decision.changedFiles ?? []).map((file) => `- \`${file}\``),
    '',
    'Affected packages:',
    ...((decision.affectedPackages?.length ?? 0) > 0
      ? decision.affectedPackages.map((name) => `- \`${name}\``)
      : ['- (none)']),
    '',
    'Reasons:',
    ...((decision.reasons?.length ?? 0) > 0
      ? decision.reasons.map((reason) => `- ${reason.code} [${reason.scope}]: ${reason.subject}`)
      : ['- (none)']),
  ].join('\n');
}

function findPackageForFile(file, workspacePackages) {
  return workspacePackages
    .filter(
      (workspacePackage) =>
        file === workspacePackage.dir || file.startsWith(`${workspacePackage.dir}/`),
    )
    .sort((left, right) => right.dir.length - left.dir.length)[0];
}

function isCiRootToolchainPath(file) {
  return (
    sharedImageAndToolchainFiles.has(file) ||
    /^tsconfig(?:\..*)?\.json$/u.test(file) ||
    file.startsWith('.github/workflows/') ||
    file.startsWith('scripts/check/') ||
    file.startsWith('.turbo/')
  );
}

function isCiDocsPath(file) {
  return (
    file === 'AGENTS.md' ||
    file.startsWith('.codex/') ||
    file.startsWith('docs/') ||
    file === '.github/pull_request_template.md'
  );
}

function isCiMaintenanceOnlyPath(file) {
  return (
    isCiDocsPath(file) ||
    file.startsWith('.agents/skills/') ||
    file.startsWith('scripts/git/') ||
    /^scripts\/release\/release-label-policy(?:\.test)?\.mjs$/u.test(file)
  );
}

function isCiRuntimePath(file) {
  return (
    /^(?:Dockerfile|docker-compose(?:\.[^/]+)?\.ya?ml)$/u.test(file) ||
    /^(?:docker|scripts\/deploy|scripts\/smoke)\//u.test(file)
  );
}

function isCiTelegramPath(file) {
  return (
    file.startsWith('packages/telegram-ops-bot/') ||
    /^(?:docker-compose(?:\.[^/]+)?\.ya?ml|docker\/|scripts\/deploy\/)/u.test(file) ||
    /(?:^|\/)(?:telegram[^/]*smoke|smoke[^/]*telegram)(?:\.|\/|-)/u.test(file)
  );
}

function isKnownCiNonPackagePath(file) {
  return (
    isCiDocsPath(file) ||
    isCiMaintenanceOnlyPath(file) ||
    isCiRuntimePath(file) ||
    isCiTelegramPath(file)
  );
}

function stableCiDecision(decision) {
  decision.affectedPackages = uniqueSorted(decision.affectedPackages);
  decision.reasons = [
    ...new Map(
      decision.reasons.map((reason) => [
        `${reason.code}\0${reason.scope}\0${reason.subject}`,
        reason,
      ]),
    ).values(),
  ].sort((left, right) =>
    `${left.code}\0${left.scope}\0${left.subject}`.localeCompare(
      `${right.code}\0${right.scope}\0${right.subject}`,
    ),
  );
  return decision;
}

function readWorkspacePatterns(workspaceFile) {
  const text = readFileSync(workspaceFile, 'utf8');
  return splitLines(text)
    .map((line) => line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/u)?.[1])
    .filter(Boolean);
}

function expandWorkspacePattern(repoRoot, pattern) {
  if (!pattern.endsWith('/*')) return [];
  const parent = path.join(repoRoot, pattern.slice(0, -2));
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name))
    .filter((dir) => existsSync(path.join(dir, 'package.json')));
}

function readPackageManifest(dir) {
  const manifestPath = path.join(dir, 'package.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return {
    ...manifest,
    dir,
  };
}

function normalizePath(file) {
  return file.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function isValidChangedFileStatus(status) {
  if (/^[ADMTUXB]$/u.test(status)) return true;
  const scored = /^[RC](\d{1,3})$/u.exec(status);
  return scored !== null && Number(scored[1]) <= 100;
}

function splitLines(value) {
  return String(value)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const defaultTurboTasks = ['build', 'typecheck', 'lint', 'test:unit:prebuilt'];
const alwaysLanes = [
  lane('guard:orchestrator:boundary', ['run', 'guard:orchestrator:boundary'], {
    reason: 'cheap global orchestrator boundary guard',
  }),
  lane('release:verify:contracts', ['run', 'release:verify:contracts'], {
    reason: 'cheap global contract consistency guard',
  }),
];

const broadFallbackFiles = new Set([
  '.gitignore',
  '.nvmrc',
  'biome.json',
  'eslint.config.js',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'vitest.config.ts',
]);

export async function collectChangedFiles({ mergeBase, runGit }) {
  const commandSets = [
    ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${mergeBase}...HEAD`],
    ['diff', '--name-only', '--diff-filter=ACMRTUXB'],
    ['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB'],
    ['ls-files', '--others', '--exclude-standard'],
  ];

  const files = new Set();
  for (const args of commandSets) {
    const output = await runGit(args);
    for (const file of splitLines(output)) {
      files.add(normalizePath(file));
    }
  }
  return [...files].sort();
}

export async function resolveComparisonBase({ baseRef = 'origin/main', runGit }) {
  let baseSha;
  try {
    baseSha = firstLine(await runGit(['rev-parse', '--verify', baseRef]));
  } catch (error) {
    throw new Error(`${baseRef} is unavailable; fetch ${baseRef} or run check:pre-pr`, {
      cause: error,
    });
  }

  let mergeBase;
  try {
    mergeBase = firstLine(await runGit(['merge-base', 'HEAD', baseRef]));
  } catch (error) {
    throw new Error(`no merge base found for ${baseRef}; run check:pre-pr`, { cause: error });
  }

  let remoteSha;
  try {
    remoteSha = firstLine(await runGit(['ls-remote', 'origin', 'refs/heads/main'])).split(
      /\s+/u,
    )[0];
  } catch (error) {
    throw new Error(`could not verify ${baseRef} freshness against origin/main; run check:pre-pr`, {
      cause: error,
    });
  }

  if (!remoteSha) {
    throw new Error(`could not verify ${baseRef} freshness against origin/main; run check:pre-pr`);
  }

  if (remoteSha !== baseSha) {
    throw new Error(`${baseRef} is stale; fetch origin main before running affected validation`);
  }

  return {
    baseRef,
    mergeBase,
    baseSha,
    remoteSha,
  };
}

export function buildAffectedCheckPlan({
  baseRef,
  mergeBase,
  changedFiles,
  workspacePackages,
  turboConcurrency = '50%',
}) {
  const normalizedFiles = uniqueSorted(changedFiles.map(normalizePath));
  const packageByName = new Map(
    workspacePackages.map((workspacePackage) => [workspacePackage.name, workspacePackage]),
  );
  const changedPackages = new Set();
  const unknownPackageFiles = [];
  const unclassifiedRootFiles = [];
  const pathTriggeredLanes = [];

  for (const file of normalizedFiles) {
    const matchedPackage = findPackageForFile(file, workspacePackages);
    if (matchedPackage) {
      if (!matchedPackage.name) {
        unknownPackageFiles.push(file);
      } else {
        changedPackages.add(matchedPackage.name);
      }
    } else if (!isClassifiedNonPackageFile(file)) {
      unclassifiedRootFiles.push(file);
    }

    pathTriggeredLanes.push(...resolvePathTriggeredLanes(file));
  }

  if (unknownPackageFiles.length > 0) {
    return fallbackPlan({
      baseRef,
      mergeBase,
      changedFiles: normalizedFiles,
      reason: `changed package file has no package metadata: ${unknownPackageFiles.join(', ')}`,
    });
  }

  if (unclassifiedRootFiles.length > 0) {
    return fallbackPlan({
      baseRef,
      mergeBase,
      changedFiles: normalizedFiles,
      reason: `unclassified root file changed: ${unclassifiedRootFiles.join(', ')}`,
    });
  }

  if (normalizedFiles.some(isBroadFallbackFile)) {
    return fallbackPlan({
      baseRef,
      mergeBase,
      changedFiles: normalizedFiles,
      reason:
        'root validation, package manager, TypeScript, Vitest, Biome, ESLint, or Turbo config changed',
    });
  }

  const affectedPackages = expandTransitiveDependents({
    packageNames: [...changedPackages],
    workspacePackages,
  });
  const dependencyPackages = expandTransitiveDependencies({
    packageNames: affectedPackages,
    workspacePackages,
  }).filter((packageName) => !affectedPackages.includes(packageName));

  const changedFileLanes = resolveChangedFileLanes(normalizedFiles);
  const triggeredLanes = uniqueLanes([...alwaysLanes, ...changedFileLanes, ...pathTriggeredLanes]);

  return {
    baseRef,
    mergeBase,
    changedFiles: normalizedFiles,
    changedPackages: [...changedPackages].sort(),
    affectedPackages,
    dependencyPackages,
    triggeredLanes,
    skippedBroadLanes: resolveSkippedBroadLanes({ changedFiles: normalizedFiles, triggeredLanes }),
    turbo: buildTurboPlan({
      affectedPackages,
      dependencyPackages,
      packageByName,
      turboConcurrency,
    }),
    fallback: null,
  };

  function fallbackPlan({ baseRef, mergeBase, changedFiles, reason }) {
    return {
      baseRef,
      mergeBase,
      changedFiles,
      changedPackages: [],
      affectedPackages: [],
      dependencyPackages: [],
      triggeredLanes: [
        lane('check:pre-pr', ['run', 'check:pre-pr'], {
          reason,
        }),
      ],
      skippedBroadLanes: [],
      turbo: null,
      fallback: {
        lane: 'check:pre-pr',
        reason,
      },
    };
  }
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

export function expandTransitiveDependencies({ packageNames, workspacePackages }) {
  const packageByName = new Map(
    workspacePackages.map((workspacePackage) => [workspacePackage.name, workspacePackage]),
  );
  const seen = new Set();
  const queue = [...packageNames];
  while (queue.length > 0) {
    const current = queue.shift();
    const workspacePackage = packageByName.get(current);
    if (!workspacePackage) continue;
    for (const dependency of workspacePackage.dependencies ?? []) {
      if (!seen.has(dependency) && packageByName.has(dependency)) {
        seen.add(dependency);
        queue.push(dependency);
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
    scripts: Object.keys(manifest.scripts ?? {}).sort(),
  }));
}

export function formatPlanSummary(plan) {
  const lines = [
    `Base: ${plan.baseRef}`,
    `Merge base: ${plan.mergeBase}`,
    `Changed files: ${plan.changedFiles.length}`,
    ...plan.changedFiles.map((file) => `  - ${file}`),
  ];

  if (plan.fallback) {
    lines.push('', `Fallback: ${plan.fallback.lane}`, `Reason: ${plan.fallback.reason}`);
    return lines.join('\n');
  }

  lines.push(
    '',
    'Changed packages:',
    ...(plan.changedPackages.length > 0
      ? plan.changedPackages.map((packageName) => `  - ${packageName}`)
      : ['  (none)']),
    'Affected packages:',
    ...(plan.affectedPackages.length > 0
      ? plan.affectedPackages.map((packageName) => `  - ${packageName}`)
      : ['  (none)']),
  );

  if (plan.dependencyPackages.length > 0) {
    lines.push(
      'Workspace dependencies built by Turbo:',
      ...plan.dependencyPackages.map((packageName) => `  - ${packageName}`),
    );
  }

  lines.push(
    'Triggered lanes:',
    ...plan.triggeredLanes.map((lane) => `  - ${lane.id}: ${lane.reason}`),
  );

  if (plan.turbo) {
    lines.push(
      'Turbo:',
      ...plan.turbo.taskGroups.map(
        (group) => `  ${group.task}: ${group.filters.join(', ')}\n    repro: ${group.repro}`,
      ),
    );
  } else {
    lines.push('Turbo:', '  skipped: no affected workspace packages');
  }

  if (plan.skippedBroadLanes.length > 0) {
    lines.push('Skipped broad lanes:', ...plan.skippedBroadLanes.map((lane) => `  - ${lane}`));
  }

  return lines.join('\n');
}

function buildTurboPlan({ affectedPackages, dependencyPackages, packageByName, turboConcurrency }) {
  if (affectedPackages.length === 0) return null;

  const taskGroups = defaultTurboTasks
    .map((task) => {
      const filters = affectedPackages.filter((packageName) =>
        packageByName.get(packageName)?.scripts?.includes(task),
      );
      if (filters.length === 0) return null;
      const args = [
        'exec',
        'turbo',
        'run',
        task,
        `--concurrency=${turboConcurrency}`,
        '--summarize',
        ...filters.map((packageName) => `--filter=${packageName}`),
      ];
      return {
        id: `turbo:${task}`,
        task,
        filters,
        args,
        repro: ['pnpm', ...args].join(' '),
      };
    })
    .filter(Boolean);

  if (taskGroups.length === 0) return null;

  return {
    id: 'turbo:affected-packages',
    tasks: taskGroups.map((group) => group.task),
    filters: affectedPackages,
    dependencyFilters: dependencyPackages,
    taskGroups,
  };
}

function resolveChangedFileLanes(files) {
  const lanes = [];
  const biomeFiles = files.filter(isBiomeLintCandidate);
  if (biomeFiles.length > 0) {
    lanes.push(
      lane('biome:changed-files', ['exec', 'biome', 'lint', ...biomeFiles], {
        reason: 'Biome-supported changed files',
      }),
    );
  }

  const prettierFiles = files.filter(isPrettierCandidate);
  if (prettierFiles.length > 0) {
    lanes.push(
      lane('format:prettier:changed', ['exec', 'prettier', '--check', ...prettierFiles], {
        reason: 'Markdown, YAML, or package JSON changed',
      }),
    );
  }

  if (files.some(isSpecializedEslintCandidate)) {
    lanes.push(
      lane('lint:eslint:specialized', ['run', 'lint:eslint:specialized'], {
        reason: 'frontend or test file touched specialized ESLint coverage',
      }),
    );
  }

  return lanes;
}

function resolvePathTriggeredLanes(file) {
  const lanes = [];
  if (isDocsFile(file)) {
    lanes.push(
      lane('docs:check', ['run', 'docs:check'], {
        reason: 'active documentation changed',
      }),
    );
    if (isDocsIndexFile(file)) {
      lanes.push(
        lane('docs:generate:indexes', ['run', 'docs:generate:indexes'], {
          reason: 'documentation router or index input changed',
        }),
      );
    }
  }

  if (file.startsWith('.github/workflows/')) {
    lanes.push(
      lane('lint:workflows', ['run', 'lint:workflows'], {
        reason: 'GitHub workflow changed',
      }),
    );
  }

  if (file.startsWith('scripts/') && file.endsWith('.sh')) {
    lanes.push(
      lane('lint:shell', ['run', 'lint:shell'], {
        reason: 'shell script changed',
      }),
    );
  }

  if (isDockerFile(file)) {
    lanes.push(
      lane('docker:lint', ['run', 'docker:lint'], {
        reason: 'Docker or Compose surface changed',
      }),
    );
    if (file === 'docker-compose.prod.yml' || file.startsWith('scripts/deploy/')) {
      lanes.push(
        lane('docker:prod:config', ['run', 'docker:prod:config'], {
          reason: 'production Compose or deploy path changed',
        }),
      );
    }
  }

  if (isBackendMigrationOrSchema(file)) {
    lanes.push(
      lane('backend:db:verify-baseline', [
        '--filter',
        '@esl-pipeline/batch-backend',
        'run',
        'db:verify-baseline',
      ]),
      lane('backend:test:db:migrations', [
        '--filter',
        '@esl-pipeline/batch-backend',
        'run',
        'test:db:migrations',
      ]),
      lane('backend:test:db:postgres', [
        '--filter',
        '@esl-pipeline/batch-backend',
        'run',
        'test:db:postgres',
      ]),
    );
  }

  if (isBackendWorkerFile(file)) {
    lanes.push(
      lane('backend:test:integration:worker', [
        '--filter',
        '@esl-pipeline/batch-backend',
        'run',
        'test:integration:worker',
      ]),
    );
  }

  if (isBackendHttpFile(file)) {
    lanes.push(
      lane('backend:test:integration:http', [
        '--filter',
        '@esl-pipeline/batch-backend',
        'run',
        'test:integration:http',
      ]),
    );
  }

  return lanes;
}

function resolveSkippedBroadLanes({ changedFiles, triggeredLanes }) {
  const triggeredIds = new Set(triggeredLanes.map((lane) => lane.id));
  const skipped = [];
  if (!triggeredIds.has('backend:test:integration:worker')) {
    skipped.push('backend worker integration: no worker or queue paths changed');
  }
  if (!triggeredIds.has('backend:test:integration:http')) {
    skipped.push('backend HTTP integration: no HTTP transport paths changed');
  }
  if (!changedFiles.some(isBackendMigrationOrSchema)) {
    skipped.push('DB migration/postgres lanes: no migrations or schema baseline changed');
  }
  skipped.push('check:pre-pr: no broad fallback trigger');
  return skipped;
}

function findPackageForFile(file, workspacePackages) {
  return workspacePackages
    .filter(
      (workspacePackage) =>
        file === workspacePackage.dir || file.startsWith(`${workspacePackage.dir}/`),
    )
    .sort((left, right) => right.dir.length - left.dir.length)[0];
}

function isClassifiedNonPackageFile(file) {
  return (
    isDocsFile(file) ||
    isBroadFallbackFile(file) ||
    file.startsWith('.github/workflows/') ||
    file === '.github/pull_request_template.md' ||
    file.startsWith('scripts/') ||
    isDockerFile(file)
  );
}

function isBroadFallbackFile(file) {
  return (
    broadFallbackFiles.has(file) ||
    /^tsconfig(?:\..*)?\.json$/u.test(file) ||
    file.startsWith('scripts/check/') ||
    file.startsWith('.turbo/')
  );
}

function isDocsFile(file) {
  return (
    file === 'AGENTS.md' || file.startsWith('docs/') || file === '.github/pull_request_template.md'
  );
}

function isDocsIndexFile(file) {
  return (
    file === 'AGENTS.md' ||
    file === 'docs/README.md' ||
    file === 'docs/reference/DOCS_IA_MAP.md' ||
    file.startsWith('docs/generated/')
  );
}

function isDockerFile(file) {
  return (
    file === 'docker-compose.yml' ||
    file === 'docker-compose.prod.yml' ||
    /(^|\/)Dockerfile[^/]*$/u.test(file) ||
    file.startsWith('scripts/docker/') ||
    file.startsWith('scripts/deploy/')
  );
}

function isBackendMigrationOrSchema(file) {
  return (
    file.startsWith('packages/batch-backend/migrations/') ||
    file === 'packages/batch-backend/schema.sql'
  );
}

function isBackendWorkerFile(file) {
  return (
    /^packages\/batch-backend\/src\/transport\/.*worker.*\.ts$/u.test(file) ||
    /^packages\/batch-backend\/src\/infrastructure\/.*queue.*\.ts$/u.test(file) ||
    /^packages\/batch-backend\/src\/application\/process-.*-job\.ts$/u.test(file) ||
    file === 'packages/batch-backend/src/application/process-queue-job.ts'
  );
}

function isBackendHttpFile(file) {
  return (
    file === 'packages/batch-backend/src/transport/http-server.ts' ||
    /^packages\/batch-backend\/src\/transport\/.*routes.*\.ts$/u.test(file) ||
    /^packages\/batch-backend\/src\/transport\/.*middleware.*\.ts$/u.test(file)
  );
}

function isBiomeLintCandidate(file) {
  return (
    /^(packages|scripts)\//u.test(file) &&
    /\.(?:js|mjs|cjs|ts|tsx|json|jsonc)$/u.test(file) &&
    !file.includes('/dist/') &&
    !file.includes('/node_modules/')
  );
}

function isPrettierCandidate(file) {
  return /\.(?:md|ya?ml)$/u.test(file) || /(^|\/)package\.json$/u.test(file);
}

function isSpecializedEslintCandidate(file) {
  return (
    /^packages\/batch-frontend\/.*\.(?:ts|tsx)$/u.test(file) ||
    /^packages\/.*\.(?:test|spec)\.(?:js|mjs|cjs|ts|tsx)$/u.test(file)
  );
}

function uniqueLanes(lanes) {
  const byId = new Map();
  for (const laneEntry of lanes) {
    if (!byId.has(laneEntry.id)) byId.set(laneEntry.id, laneEntry);
  }
  return [...byId.values()];
}

function lane(id, pnpmArgs, options = {}) {
  return {
    id,
    pnpmArgs,
    reason: options.reason ?? id,
    repro: ['pnpm', ...pnpmArgs].join(' '),
  };
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
  return file.trim().replaceAll('\\', '/').replace(/^\.\//u, '');
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

function firstLine(value) {
  return splitLines(value)[0] ?? '';
}

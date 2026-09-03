import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const defaultTurboTasks = ['build', 'typecheck', 'test:unit:prebuilt'];
const alwaysLanes = [
  lane('guard:orchestrator:boundary', ['run', 'guard:orchestrator:boundary'], {
    reason: 'cheap global orchestrator boundary guard',
  }),
  lane('release:verify:contracts', ['run', 'release:verify:contracts'], {
    reason: 'cheap global contract consistency guard',
  }),
  lane('test:check-routing', ['run', 'test:check-routing'], {
    reason: 'backend operational test routing guard',
  }),
];
const broadPrePrLanes = [
  ...alwaysLanes,
  lane('test:tooling', ['run', 'test:tooling'], {
    reason: 'broad repository tooling regression coverage',
  }),
  lane('build', ['run', 'build'], {
    reason: 'broad workspace build coverage',
  }),
  lane('typecheck', ['run', 'typecheck'], {
    reason: 'broad workspace typecheck coverage',
  }),
  lane('lint', ['run', 'lint'], {
    reason: 'broad workspace lint coverage',
  }),
  lane('test:unit:prebuilt:fast', ['run', 'test:unit:prebuilt:fast'], {
    reason: 'broad prebuilt core unit regression coverage',
  }),
];

const broadFallbackFiles = new Set([
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

export async function collectChangedFileScopes({ mergeBase, runGit }) {
  const nameStatusArgs = [
    '--name-status',
    '-z',
    '--find-renames',
    '--find-copies',
    '--diff-filter=ACDMRTUXB',
  ];
  const hostedRecords = parseNameStatusZ(
    await runGit(['diff', ...nameStatusArgs, `${mergeBase}...HEAD`]),
  );
  const unstagedRecords = parseNameStatusZ(await runGit(['diff', ...nameStatusArgs]));
  const stagedRecords = parseNameStatusZ(await runGit(['diff', '--cached', ...nameStatusArgs]));
  const untrackedRecords = String(
    await runGit(['ls-files', '--others', '--exclude-standard', '-z']),
  )
    .split('\0')
    .filter(Boolean)
    .map((file) => ({ status: '?', paths: [normalizePath(file)] }));

  const uniqueRecords = (records) => [
    ...new Map(
      records.map((record) => [`${record.status}\0${record.paths.join('\0')}`, record]),
    ).values(),
  ];
  const uncommittedRecords = uniqueRecords([
    ...unstagedRecords,
    ...stagedRecords,
    ...untrackedRecords,
  ]);
  const localRecords = uniqueRecords([...hostedRecords, ...uncommittedRecords]);

  return {
    hostedRecords: uniqueRecords(hostedRecords),
    localRecords,
    hostedFiles: flattenChangedFileRecords(hostedRecords),
    localFiles: flattenChangedFileRecords(localRecords),
    uncommittedFiles: flattenChangedFileRecords(uncommittedRecords),
  };
}

export async function collectChangedFiles(options) {
  return (await collectChangedFileScopes(options)).localFiles;
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

  const changedPackages = new Set();
  let conservativeFallback = false;
  for (const file of changedFiles) {
    const matchedPackage = findPackageForFile(file, workspacePackages);
    if (matchedPackage?.name) changedPackages.add(matchedPackage.name);

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
    addReason('runtime-change', 'runtime', changedFiles.join(','));
    addReason('runtime-implies-integration', 'integration', 'runtime');
  }

  const sharedHighRiskPackages = new Set([
    '@esl-pipeline/contracts',
    '@esl-pipeline/shared-infrastructure',
  ]);
  if (
    !conservativeFallback &&
    ([...changedPackages].some((name) => sharedHighRiskPackages.has(name)) ||
      changedFiles.some(isCiBackendDbWorkerPath))
  ) {
    decision.backend_db_worker = true;
    addReason('backend-db-worker-change', 'backend_db_worker', changedFiles.join(','));
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
        'root validation, package manager, TypeScript, Vitest, Biome, or Turbo config changed',
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
  const ciRequirements = resolveCiRequirements(normalizedFiles);

  return {
    baseRef,
    mergeBase,
    changedFiles: normalizedFiles,
    changedPackages: [...changedPackages].sort(),
    affectedPackages,
    dependencyPackages,
    triggeredLanes,
    ciRequirements,
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
    const plan = buildBroadCheckPlan({ baseRef, mergeBase, changedFiles, reason, fallback: true });
    return {
      ...plan,
      triggeredLanes: uniqueLanes([
        ...plan.triggeredLanes,
        ...resolveChangedFileLanes(changedFiles).filter(
          (laneEntry) => laneEntry.id === 'format:biome:changed',
        ),
      ]),
    };
  }
}

export function buildBroadCheckPlan({
  reason,
  baseRef = '(broad)',
  mergeBase = '(broad)',
  changedFiles = [],
  fallback = false,
}) {
  const normalizedFiles = uniqueSorted(changedFiles.map(normalizePath));
  return {
    baseRef,
    mergeBase,
    changedFiles: normalizedFiles,
    changedPackages: [],
    affectedPackages: [],
    dependencyPackages: [],
    triggeredLanes: broadPrePrLanes,
    ciRequirements: resolveCiRequirements(normalizedFiles, {
      conservativeReason: fallback
        ? 'changed scope requires conservative hosted service evidence'
        : normalizedFiles.length === 0
          ? 'explicit broad validation requires hosted service evidence'
          : null,
    }),
    skippedBroadLanes: [],
    turbo: null,
    fallback: fallback
      ? {
          lane: 'check:pre-pr',
          reason,
        }
      : null,
  };
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
    if (plan.ciRequirements.length > 0) {
      lines.push(
        '',
        'CI required:',
        ...plan.ciRequirements.map((requirement) => `  - ${requirement.id}: ${requirement.reason}`),
      );
    }
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

  const localLanes = plan.triggeredLanes.filter((lane) => lane.owner === 'local');
  const ciLanes = plan.triggeredLanes.filter((lane) => lane.owner === 'ci');
  lines.push('Local lanes:', ...localLanes.map((lane) => `  - ${lane.id}: ${lane.reason}`));
  if (ciLanes.length > 0) {
    lines.push('CI-owned lanes:', ...ciLanes.map((lane) => `  - ${lane.id}: ${lane.reason}`));
  }
  if (plan.ciRequirements.length > 0) {
    lines.push(
      'CI required:',
      ...plan.ciRequirements.map((requirement) => `  - ${requirement.id}: ${requirement.reason}`),
    );
  }

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

export function formatCiScopeGithubOutputs(decision) {
  return ['runtime', 'integration', 'backend_db_worker', 'telegram', 'docs_only']
    .map((scope) => `${scope}=${decision[scope] === true}`)
    .join('\n')
    .concat('\n');
}

export function formatCiScopeSummary(decision) {
  const scopes = ['runtime', 'integration', 'backend_db_worker', 'telegram', 'docs_only'];
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

export function formatScopePreview({ planText, hostedDecision, uncommittedFiles }) {
  const count = uncommittedFiles.length;
  return [
    '## Local validation scope',
    '',
    planText,
    '',
    '## Hosted CI preview',
    '',
    `Hosted preview excludes ${count} uncommitted ${count === 1 ? 'path' : 'paths'}.`,
    '',
    formatCiScopeSummary(hostedDecision),
  ].join('\n');
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

  const biomeManifestFiles = files.filter(isBiomeManifestCandidate);
  if (biomeManifestFiles.length > 0) {
    lanes.push(
      lane(
        'format:biome:changed',
        [
          'exec',
          'biome',
          'check',
          '--formatter-enabled=true',
          '--linter-enabled=false',
          '--assist-enabled=true',
          ...biomeManifestFiles,
        ],
        {
          reason: 'package manifest formatting and sorting is owned by Biome',
        },
      ),
    );
  }

  const prettierFiles = files.filter(isPrettierCandidate);
  if (prettierFiles.length > 0) {
    lanes.push(
      lane('format:prettier:changed', ['exec', 'prettier', '--check', ...prettierFiles], {
        reason: 'Markdown or YAML changed',
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
      lane(
        'backend:test:db:migrations',
        ['--filter', '@esl-pipeline/batch-backend', 'run', 'test:db:migrations'],
        {
          owner: 'ci',
          reason: 'backend migrations or schema changed',
        },
      ),
      lane(
        'backend:test:db:postgres',
        ['--filter', '@esl-pipeline/batch-backend', 'run', 'test:db:postgres'],
        {
          owner: 'ci',
          reason: 'backend migrations or schema changed',
        },
      ),
    );
  }

  if (isBackendWorkerFile(file)) {
    lanes.push(
      lane(
        'backend:test:integration:worker',
        ['--filter', '@esl-pipeline/batch-backend', 'run', 'test:integration:worker'],
        {
          owner: 'ci',
          reason: 'backend worker or queue behavior changed',
        },
      ),
    );
  }

  if (isBackendWorkerTest(file)) {
    lanes.push(
      lane(
        'backend:test:integration:worker',
        ['--filter', '@esl-pipeline/batch-backend', 'run', 'test:integration:worker'],
        {
          owner: 'ci',
          reason: 'backend worker or queue behavior changed',
        },
      ),
    );
  }

  if (isBackendPostgresTest(file) || isBackendRepositoryImplementation(file)) {
    lanes.push(
      lane(
        'backend:test:db:postgres',
        ['--filter', '@esl-pipeline/batch-backend', 'run', 'test:db:postgres'],
        {
          owner: 'ci',
          reason: 'backend repository or database test behavior changed',
        },
      ),
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

function isGeneratedDocsFile(file) {
  return file.startsWith('docs/generated/');
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
    (/^(packages|scripts)\//u.test(file) || /(^|\/)package\.json$/u.test(file)) &&
    /\.(?:js|jsx|mjs|cjs|ts|tsx|css|json|jsonc)$/u.test(file) &&
    !isGeneratedDocsFile(file) &&
    !file.includes('/dist/') &&
    !file.includes('/node_modules/')
  );
}

function isBiomeManifestCandidate(file) {
  return !isGeneratedDocsFile(file) && /(^|\/)package\.json$/u.test(file);
}

function isPrettierCandidate(file) {
  return !isGeneratedDocsFile(file) && /\.(?:md|ya?ml)$/u.test(file);
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
    owner: options.owner ?? 'local',
    reason: options.reason ?? id,
    repro: ['pnpm', ...pnpmArgs].join(' '),
  };
}

function resolveCiRequirements(files, { conservativeReason = null } = {}) {
  const reasons = [];
  const addReason = (reason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  for (const file of files) {
    if (isBackendMigrationOrSchema(file)) {
      addReason('backend migrations or schema changed');
    } else if (isBackendWorkerFile(file) || isBackendWorkerTest(file)) {
      addReason('backend worker or queue behavior changed');
    } else if (
      isBackendPostgresTest(file) ||
      isBackendRepositoryImplementation(file) ||
      file.startsWith('packages/batch-backend/tests/support/')
    ) {
      addReason('backend repository or database test behavior changed');
    } else if (file.startsWith('packages/batch-backend/src/infrastructure/')) {
      addReason('backend service infrastructure changed');
    } else if (file.startsWith('packages/contracts/')) {
      addReason('shared contracts changed');
    } else if (file.startsWith('packages/shared-infrastructure/')) {
      addReason('shared infrastructure changed');
    } else if (file.startsWith('.github/workflows/') || isCiRootToolchainPath(file)) {
      addReason('validation or workflow infrastructure changed');
    }
  }

  if (conservativeReason && reasons.length === 0) {
    addReason(conservativeReason);
  }
  if (reasons.length === 0) return [];
  return [{ id: 'backend-db-integration', reason: reasons.join('; ') }];
}

function isBackendPostgresTest(file) {
  return /^packages\/batch-backend\/tests\/(?:domain\.(?:.*-repository|student-memory-openai-batch-import|student-repository\.workspace)|application\.(?:assignment-step-confirmation|homework-memory-source|student-timeline|student-schedule-billing|alpha-invites\.registration)|integration\.(?:migrations|query-plan-regression|recording-tenant-authority))\.test\.ts$/u.test(
    file,
  );
}

function isBackendWorkerTest(file) {
  return /^packages\/batch-backend\/tests\/(?:transport\.worker-runner\.integration|integration\.student-memory-pacing-delay)\.test\.ts$/u.test(
    file,
  );
}

function isBackendRepositoryImplementation(file) {
  return /^packages\/batch-backend\/src\/domain\/.*-repository\.ts$/u.test(file);
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

function isCiDocsPath(file) {
  return (
    file === 'AGENTS.md' ||
    file.startsWith('.codex/') ||
    file.startsWith('docs/') ||
    file === '.github/pull_request_template.md'
  );
}

function isCiRootToolchainPath(file) {
  return (
    isBroadFallbackFile(file) ||
    file.startsWith('.github/workflows/') ||
    /^scripts\/check\/(?:affected-check|run-affected-check|run-ci-scope)/u.test(file)
  );
}

function isCiRuntimePath(file) {
  return (
    /^(?:Dockerfile|docker-compose(?:\.[^/]+)?\.ya?ml)$/u.test(file) ||
    /^(?:docker|scripts\/deploy|scripts\/smoke)\//u.test(file)
  );
}

function isCiBackendDbWorkerPath(file) {
  return (
    /^packages\/batch-backend\/(?:migrations\/|schema\.sql$)/u.test(file) ||
    /^packages\/batch-backend\/src\/infrastructure\//u.test(file) ||
    isBackendRepositoryImplementation(file) ||
    /^packages\/batch-backend\/src\/.*(?:worker|queue|process-(?:queue-)?job)/u.test(file) ||
    /^packages\/batch-backend\/tests\/support\//u.test(file) ||
    isBackendPostgresTest(file) ||
    isBackendWorkerTest(file)
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
  return isCiDocsPath(file) || isCiRuntimePath(file) || isCiTelegramPath(file);
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

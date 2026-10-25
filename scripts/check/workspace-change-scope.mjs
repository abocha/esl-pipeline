import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { BACKEND_TEST_PROJECT_FILES } from '../../packages/batch-backend/vitest.projects.mjs';

const sharedImageAndToolchainFiles = new Set([
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
  const blockingScopes = ['build_unit', 'integration', 'backend_db_worker', 'telegram', 'media'];
  const decision = {
    build_unit: false,
    media: false,
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
  for (const file of changedFiles) {
    const matchedPackage = findPackageForFile(file, workspacePackages);
    if (matchedPackage?.name) {
      changedPackages.add(matchedPackage.name);
      decision.build_unit = true;
      addReason('workspace-package', 'build_unit', `${file} -> ${matchedPackage.name}`);
    } else if (matchedPackage) {
      enableAll('untrusted-workspace-metadata', file);
      continue;
    }

    if (isCiRootToolchainPath(file)) {
      enableAll('root-toolchain', file);
    } else if (!matchedPackage && !isKnownCiNonPackagePath(file)) {
      enableAll('unknown-path', file);
    }

    // Each selector owns its evidence independently; package impact alone must
    // never promote a backend/frontend edit to every service lane.
    for (const [scope, selects] of [
      ['integration', isCiIntegrationPath],
      ['backend_db_worker', isCiBackendDbWorkerPath],
      ['media', isCiMediaPath],
      ['telegram', isCiTelegramPath],
    ]) {
      if (selects(file)) {
        decision[scope] = true;
        addReason('owned-surface', scope, file);
      }
    }
  }

  decision.affectedPackages = expandTransitiveDependents({
    packageNames: [...changedPackages],
    workspacePackages,
  });
  if (decision.affectedPackages.includes('@esl-pipeline/telegram-ops-bot')) {
    decision.telegram = true;
    for (const name of changedPackages) {
      if (
        expandTransitiveDependents({ packageNames: [name], workspacePackages }).includes(
          '@esl-pipeline/telegram-ops-bot',
        )
      ) {
        addReason('telegram-dependency', 'telegram', name);
      }
    }
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
    'build_unit',
    'media',
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
    'build_unit',
    'media',
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
    file === 'README.md' ||
    file.startsWith('.codex/') ||
    file.startsWith('docs/') ||
    file.startsWith('scripts/docs/') ||
    file === '.github/pull_request_template.md'
  );
}

function isCiMaintenanceOnlyPath(file) {
  return (
    isCiDocsPath(file) ||
    file === '.gitignore' ||
    file.startsWith('.agents/skills/') ||
    file.startsWith('scripts/git/') ||
    /^scripts\/release\/(?:release-label-policy|production-image-scope)(?:\.test)?\.mjs$/u.test(
      file,
    )
  );
}

// Ownership rules follow the commands in ci.yml: HTTP + pipeline/provider
// integration, PostgreSQL + Redis, and FFmpeg recording evidence. Keep changes
// here bootstrap-full (scripts/check/**), including changes to the ownership map.
const backendRoot = 'packages/batch-backend/';
const backendTests = (projects) =>
  new Set(
    projects.flatMap((project) =>
      BACKEND_TEST_PROJECT_FILES[project].map((file) => `${backendRoot}tests/${file}`),
    ),
  );
const dbWorkerTests = backendTests(['migrations', 'postgres', 'worker']);
const httpTests = backendTests(['http']);
const mediaTests = backendTests(['media']);

// DB-backed application boundaries exercised by the service projects, plus
// durable execution entrypoints. Pure generation/prompt policy is deliberately
// absent. This is ownership, not import/diff analysis.
const dbApplications = new Set([
  'assignment-sessions',
  'confirm-assignment-session-step',
  'share-assignment-session',
  'homework-memory-source',
  'student-timeline',
  'student-schedule-billing',
  'alpha-invites',
  'student-memory-openai-batch-importer',
  'student-memory-openai-batch-operations',
  'student-memory-openai-batch-run-reconcile',
  'student-memory-generation-pacing',
  'submit-job',
  'approve-job',
  'create-approval-job',
  'get-job-status',
  'ops-control',
  'transcription-execution',
  'reconcile-transcription-delivery',
  'reconcile-upload-candidates',
  'ingest-recording-upload',
  'retry-recording-transcription',
  'sweep-recording-audio',
  'teacher-business-dashboard',
  'workspace-context',
  'assignment-learner-context',
  'create-prompt-package',
  'find-student',
  'get-job-provenance',
  'homework-memory-backfill',
  'ingest-manual-transcript-source',
  'profile-initial-enrichment',
  'student-lesson-history',
  'student-memory-snapshot-backfill',
]);

function isCiBackendDbWorkerPath(file) {
  if (dbWorkerTests.has(file)) return true;
  if (/^packages\/shared-infrastructure\/src\/(?:env\/|index\.ts$)/u.test(file)) return true;
  if (file === 'packages/contracts/src/job-actions.ts') return true;
  if (/^scripts\/test\/run-backend-db-worker-check(?:\.test)?\.mjs$/u.test(file)) return true;
  if (!file.startsWith(backendRoot)) return false;
  const local = file.slice(backendRoot.length);
  return (
    /^(?:migrations|docker-entrypoint-initdb\.d)\//u.test(local) ||
    /^src\/domain\/[^/]*(?:repository|model)\.ts$/u.test(local) ||
    /^src\/domain\/(?:mcp-oauth-grants|student-memory-openai-batch-import|student-utils|job-events|job-actions)\.ts$/u.test(
      local,
    ) ||
    /^src\/infrastructure\/(?:db|redis|migrations|migration-verify|schema-baseline|rls-readiness-audit|ffmpeg-semaphore|mcp-oauth-adapter|auth-service|.*queue.*|.*worker.*|.*redis-bridge|job-cancellation|orchestrator-service)\.ts$/u.test(
      local,
    ) ||
    /^src\/transport\/[^/]*worker[^/]*\.ts$/u.test(local) ||
    /^src\/transport\/(?:auth-middleware|mcp-oauth|mcp-server|core-routes|rate-limit-middleware)\.ts$/u.test(
      local,
    ) ||
    /^src\/bootstrap\/pg-[^/]*\.ts$/u.test(local) ||
    /^src\/application\/(?:process-.*-job|request-.*(?:generation|refresh)|retry-student-profile-candidate-refresh)\.ts$/u.test(
      local,
    ) ||
    local.startsWith('src/application/job-actions/') ||
    (local.startsWith('src/application/') &&
      dbApplications.has(path.posix.basename(local, '.ts'))) ||
    /^src\/tools\/(?:migrate-db|historical-profile-provenance)\.ts$/u.test(local) ||
    /^(?:vitest(?:\.[^/]+)?\.(?:mjs|ts)|src\/(?:config\/env|bootstrap\/env)\.ts)$/u.test(local) ||
    /^tests\/(?:support|setup)\//u.test(local) ||
    local === 'package.json' ||
    local === 'schema.sql' ||
    local.startsWith('tests/fixtures/pg-')
  );
}

function isCiIntegrationPath(file) {
  return (
    httpTests.has(file) ||
    /^packages\/batch-backend\/src\/transport\/(?!.*worker).*\.ts$/u.test(file) ||
    /^packages\/batch-backend\/(?:src\/(?:config\/env|bootstrap\/env|infrastructure\/orchestrator-service)\.ts|tests\/transport\.http-server\.integration\.[^/]+|tests\/(?:setup\/http\.mjs|support\/)|vitest[^/]*|package\.json)/u.test(
      file,
    ) ||
    /^packages\/(?:contracts|orchestrator|tts-provider-elevenlabs)\//u.test(file) ||
    // The pipeline integration consumes these workspace dependencies.
    /^packages\/(?:tts-core|tts-provider-inworld|tts-provider-google|tts-provider-gemini|provider-runtime|storage-uploader|html-publisher|shared-infrastructure)\//u.test(
      file,
    )
  );
}

function isCiMediaPath(file) {
  return (
    mediaTests.has(file) ||
    file === 'packages/contracts/src/index.ts' ||
    /^packages\/provider-runtime\//u.test(file) ||
    /^packages\/shared-infrastructure\/src\/(?:env\/|index\.ts$)/u.test(file) ||
    /^packages\/batch-backend\/src\/(?:infrastructure\/(?:recording-media|ffmpeg-semaphore|transcription-storage)|application\/(?:.*transcri.*|process-transcribe-job|ingest-recording-upload|reconcile-upload-candidates|sweep-recording-audio)|transport\/extended-routes\/(?:recordings-routes|recording-provider-cache)|domain\/recording-model)\.ts$/u.test(
      file,
    ) ||
    /^packages\/batch-backend\/(?:tests\/setup\/media\.mjs|tests\/support\/|src\/(?:config\/env|bootstrap\/env)\.ts|vitest[^/]*|package\.json)/u.test(
      file,
    ) ||
    /^packages\/stt-[^/]+\//u.test(file) ||
    file.startsWith('scripts/audio-benchmark/')
  );
}

function isCiTelegramPath(file) {
  return (
    file.startsWith('packages/telegram-ops-bot/') ||
    /^(?:docker-compose(?:\.[^/]+)?\.ya?ml)$/u.test(file) ||
    /^docker\/telegram-ops-bot\//u.test(file) ||
    /(?:^|\/)(?:telegram[^/]*smoke|smoke[^/]*telegram)(?:\.|\/|-)/u.test(file) ||
    /^scripts\/smoke\/.*telegram/u.test(file)
  );
}

function isCiPackagingPath(file) {
  return (
    file === '.dockerignore' ||
    /^(?:Dockerfile|docker-compose(?:\.[^/]+)?\.ya?ml)$/u.test(file) ||
    /^(?:docker|scripts\/deploy)\//u.test(file)
  );
}

function isKnownCiNonPackagePath(file) {
  return (
    isCiMaintenanceOnlyPath(file) ||
    isCiPackagingPath(file) ||
    isCiTelegramPath(file) ||
    isCiBackendDbWorkerPath(file) ||
    isCiMediaPath(file)
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

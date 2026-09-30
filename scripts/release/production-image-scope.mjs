import { expandTransitiveDependents } from '../check/workspace-change-scope.mjs';
import { flattenChangedFilePayload } from './release-label-policy.mjs';

const TARGETS = Object.freeze({
  '@esl-pipeline/batch-backend': 'backend',
  '@esl-pipeline/batch-frontend': 'frontend',
  '@esl-pipeline/telegram-ops-bot': 'bot',
});

// Repository inputs consumed by every production Dockerfile/root build context.
const SHARED_IMAGE_INPUTS = new Set([
  '.dockerignore',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
]);

const NON_IMAGE_ROOT_FILES = new Set([
  '.dclintrc.json',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.hadolint.yaml',
  '.prettierignore',
  '.prettierrc.json',
  '.env.example',
  '.nvmrc',
  '.python-version',
  'AGENTS.md',
  'CHANGELOG.md',
  'README.md',
  'biome.json',
  'docker-compose.dev.yml',
  'docker-compose.prod.yml',
  'docker-compose.yml',
  'knip.json',
  'skills-lock.json',
  'turbo.json',
  'vitest.config.ts',
]);

// Named release/host utilities are not copied or executed by image builds.
// New build tooling under these directories must acquire explicit ownership.
const NON_IMAGE_TOOL_FILES = new Set([
  'scripts/release/compute-next-version.mjs',
  'scripts/release/guard-orchestrator-library-boundary.mjs',
  'scripts/release/production-image-scope.mjs',
  'scripts/release/release-label-policy.mjs',
  'scripts/release/resolve-production-image-scope.mjs',
  'scripts/release/resolve-release-bump-from-pr.mjs',
  'scripts/release/telegram-ops-go-live-gates.mjs',
  'scripts/release/telegram-ops-go-live-preflight.mjs',
  'scripts/release/telegram-ops-go-live-utils.mjs',
  'scripts/release/telegram-ops-go-live-verify.mjs',
  'scripts/release/verify-contract-version-consistency.mjs',
  'scripts/release/write-release-files.mjs',
  'scripts/docker/clean-dev-dependency-volumes.mjs',
  'scripts/docker/prepare-host-paths.mjs',
  'scripts/docker/prod-compose.mjs',
  'scripts/docker/run-hadolint.mjs',
  'scripts/docker/validate-caddy-config.mjs',
  'scripts/docker/validate-edge-env.mjs',
  'scripts/docker/validate-prod-image-env.mjs',
  'scripts/docker/recover-dev-stack.sh',
  'scripts/docker/verify-recording-media-runtime.sh',
  'scripts/docker/test-postgres-restore-drill.sh',
]);

function allImages(reason, changedFiles = []) {
  return {
    backend: true,
    frontend: true,
    bot: true,
    changedFiles,
    affectedPackages: [],
    reasons: [reason],
  };
}

function owningPackage(path, workspacePackages) {
  return workspacePackages
    .filter(({ dir }) => path === dir || path.startsWith(`${dir}/`))
    .sort((left, right) => right.dir.length - left.dir.length)[0];
}

function isKnownNonImagePath(path) {
  if (NON_IMAGE_ROOT_FILES.has(path) || /^[^/]+\.md$/u.test(path)) return true;
  if (NON_IMAGE_TOOL_FILES.has(path)) return true;
  if (path.startsWith('.agents/skills/') || path.startsWith('.codex/')) return true;
  if (path.startsWith('.github/') || path.startsWith('.impeccable/')) return true;
  if (path.startsWith('deploy/')) return true;
  if (/^scripts\/(?:docs|git|check|test|deploy|smoke|audio-benchmark)\//u.test(path)) return true;
  if (/^scripts\/(?:docker|release)\/[^/]+\.test\.mjs$/u.test(path)) return true;
  if (/^scripts\/docker\/(?:postgres-|run-postgres-)[^/]+\.sh$/u.test(path)) return true;
  if (path.startsWith('docs/')) return true;
  return false;
}

function isValidWorkspaceGraph(packages) {
  if (!Array.isArray(packages) || packages.length === 0) return false;
  const names = new Set(packages.map((pkg) => pkg?.name));
  const dirs = new Set(packages.map((pkg) => pkg?.dir));
  return (
    names.size === packages.length &&
    dirs.size === packages.length &&
    Object.keys(TARGETS).every((name) => names.has(name)) &&
    packages.every(
      (pkg) =>
        typeof pkg?.name === 'string' &&
        pkg.name.length > 0 &&
        typeof pkg.dir === 'string' &&
        pkg.dir.startsWith('packages/') &&
        !pkg.dir.includes('\\') &&
        pkg.dir.split('/').every((part) => part !== '' && part !== '.' && part !== '..') &&
        Array.isArray(pkg.dependencies) &&
        pkg.dependencies.every((dependency) => names.has(dependency)),
    )
  );
}

export function buildProductionImageScope({ changedFilePayload, workspacePackages = [] }) {
  let changedFiles;
  try {
    changedFiles = flattenChangedFilePayload(changedFilePayload);
  } catch (error) {
    return allImages(`fail-closed: ${error.message}`);
  }

  if (!isValidWorkspaceGraph(workspacePackages)) {
    return allImages(
      'fail-closed [all]: incomplete or invalid workspace package graph',
      changedFiles,
    );
  }

  const changedPackages = new Set();
  const reasons = [];
  const flags = { backend: false, frontend: false, bot: false };
  const enableAll = () => {
    for (const target of Object.values(TARGETS)) flags[target] = true;
  };

  for (const path of changedFiles) {
    if (SHARED_IMAGE_INPUTS.has(path)) {
      enableAll();
      reasons.push(`shared-image-input [all]: ${path}`);
      continue;
    }
    if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
      enableAll();
      reasons.push(`fail-closed [all]: invalid path ${path}`);
      continue;
    }
    const owner = owningPackage(path, workspacePackages);
    if (owner) {
      changedPackages.add(owner.name);
      continue;
    }
    if (isKnownNonImagePath(path)) {
      reasons.push(`known-non-image: ${path}`);
    } else {
      enableAll();
      reasons.push(`fail-closed [all]: unclassified path ${path}`);
    }
  }

  const affectedPackages = expandTransitiveDependents({
    packageNames: [...changedPackages],
    workspacePackages,
  });
  for (const packageName of affectedPackages) {
    const target = TARGETS[packageName];
    if (target) flags[target] = true;
  }
  for (const packageName of [...changedPackages].sort()) {
    const targets = expandTransitiveDependents({ packageNames: [packageName], workspacePackages })
      .map((name) => TARGETS[name])
      .filter(Boolean);
    const code = TARGETS[packageName] ? 'workspace-package' : 'workspace-dependent';
    reasons.push(`${code} [${targets.join(', ') || 'none'}]: ${packageName}`);
  }
  if (reasons.length === 0) reasons.push('no production image inputs changed');

  return { ...flags, changedFiles, affectedPackages, reasons };
}

export function buildProductionImageScopeFromChangedFileRecords({
  changedFileRecords,
  workspacePackages = [],
}) {
  if (
    !Array.isArray(changedFileRecords) ||
    changedFileRecords.some((record) => {
      const scored = /^[RC](\d{1,3})$/u.exec(record?.status);
      const validStatus =
        /^[ADMTUXB]$/u.test(record?.status) || (scored !== null && Number(scored[1]) <= 100);
      return (
        !validStatus || !Array.isArray(record?.paths) || record.paths.length !== (scored ? 2 : 1)
      );
    })
  ) {
    return allImages('fail-closed [all]: malformed changed-file records');
  }
  const files = Array.isArray(changedFileRecords)
    ? changedFileRecords.map((record) => {
        const paths = Array.isArray(record?.paths) ? record.paths : [];
        const filename = paths.at(-1);
        return paths.length > 1 ? { filename, previous_filename: paths[0] } : { filename };
      })
    : [];

  return buildProductionImageScope({
    changedFilePayload: {
      expectedFileCount: files.length,
      files,
    },
    workspacePackages,
  });
}

import { expandTransitiveDependents } from '../check/affected-check-lib.mjs';
import { flattenChangedFilePayload } from './release-label-policy.mjs';

const TARGETS = Object.freeze({
  '@esl-pipeline/batch-backend': 'backend',
  '@esl-pipeline/batch-frontend': 'frontend',
  '@esl-pipeline/telegram-ops-bot': 'bot',
});

const ALL_IMAGE_INPUTS = new Set([
  '.dockerignore',
  '.nvmrc',
  'docker-compose.prod.yml',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
]);

const SAFE_ROOT_FILES = new Set([
  '.dclintrc.json',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.hadolint.yaml',
  '.prettierignore',
  '.prettierrc.json',
  'AGENTS.md',
  'CHANGELOG.md',
  'README.md',
  'biome.json',
  'docker-compose.dev.yml',
  'docker-compose.yml',
  'eslint.config.js',
  'knip.json',
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

function isSafeNonImagePath(path) {
  if (SAFE_ROOT_FILES.has(path) || /^[^/]+\.md$/u.test(path)) return true;
  if (path.startsWith('.github/') || path.startsWith('.impeccable/')) return true;
  if (path.startsWith('deploy/') || path.startsWith('scripts/')) return true;
  if (path.startsWith('docs/')) return !path.startsWith('docs/prompt-gallery/');
  return false;
}

export function buildProductionImageScope({ changedFilePayload, workspacePackages = [] }) {
  let changedFiles;
  try {
    changedFiles = flattenChangedFilePayload(changedFilePayload);
  } catch (error) {
    return allImages(`fail-closed: ${error.message}`);
  }

  if (!Array.isArray(workspacePackages) || workspacePackages.length === 0) {
    return allImages('fail-closed: workspace package graph is empty', changedFiles);
  }

  const changedPackages = new Set();
  const reasons = [];
  let backend = false;

  for (const path of changedFiles) {
    if (ALL_IMAGE_INPUTS.has(path) || /^tsconfig(?:\.[^/]+)?\.json$/u.test(path)) {
      return allImages(`shared image input: ${path}`, changedFiles);
    }
    if (path.startsWith('docs/prompt-gallery/')) {
      backend = true;
      reasons.push(`backend runtime content: ${path}`);
      continue;
    }

    const owner = owningPackage(path, workspacePackages);
    if (owner) {
      changedPackages.add(owner.name);
      continue;
    }
    if (!isSafeNonImagePath(path)) {
      return allImages(`fail-closed: unclassified path ${path}`, changedFiles);
    }
  }

  const affectedPackages = expandTransitiveDependents({
    packageNames: [...changedPackages],
    workspacePackages,
  });
  const flags = { backend, frontend: false, bot: false };
  for (const packageName of affectedPackages) {
    const target = TARGETS[packageName];
    if (target) flags[target] = true;
  }
  for (const packageName of changedPackages) reasons.push(`workspace package: ${packageName}`);
  if (reasons.length === 0) reasons.push('no production image inputs changed');

  return { ...flags, changedFiles, affectedPackages, reasons };
}

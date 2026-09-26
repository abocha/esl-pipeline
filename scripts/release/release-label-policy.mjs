const RELEASE_LABEL_TO_BUMP = new Map([
  ['release:major', 'major'],
  ['release:minor', 'minor'],
  ['release:patch', 'patch'],
  ['release:none', null],
]);

const MAINTENANCE_ONLY_ROOT_FILES = new Set([
  '.dclintrc.json',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.hadolint.yaml',
  '.prettierignore',
  '.prettierrc.json',
  'biome.json',
  'knip.json',
]);

const MAINTENANCE_ONLY_EXACT_PATHS = new Set([
  'scripts/docker/run-hadolint.mjs',
  'scripts/docker/run-hadolint.test.mjs',
  'scripts/release/production-image-scope.mjs',
  'scripts/release/release-label-policy.mjs',
]);

export const RELEASE_LABELS = Object.freeze(Array.from(RELEASE_LABEL_TO_BUMP.keys()));
export const GITHUB_PR_FILES_LIMIT = 3000;

function normalizeLabelName(label) {
  if (typeof label === 'string') return label.trim();
  if (label && typeof label === 'object' && typeof label.name === 'string') {
    return label.name.trim();
  }
  return '';
}

export function normalizeRepoPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return '';
  return value.startsWith('./') ? value.slice(2) : value;
}

export function flattenChangedFilePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('A changed-file payload is required for release:none');
  }

  const { expectedFileCount, files } = payload;
  if (!Number.isInteger(expectedFileCount) || expectedFileCount <= 0) {
    throw new Error('Changed-file expectedFileCount must be a positive integer');
  }
  if (!Array.isArray(files)) {
    throw new Error('Changed-file payload files must be an array');
  }
  if (files.length >= GITHUB_PR_FILES_LIMIT) {
    throw new Error('Changed-file payload reached the 3,000-file API limit');
  }
  if (files.length !== expectedFileCount) {
    throw new Error(
      `Changed-file record count ${files.length} does not match expected count ${expectedFileCount}`,
    );
  }

  const paths = [];
  for (const record of files) {
    const filename = normalizeRepoPath(record?.filename);
    if (!filename) throw new Error('Every changed-file record must include a filename');
    paths.push(filename);

    if (record.previous_filename !== undefined) {
      const previousFilename = normalizeRepoPath(record.previous_filename);
      if (!previousFilename) {
        throw new Error('Changed-file previous_filename must be a non-empty path when present');
      }
      paths.push(previousFilename);
    }
  }

  return Array.from(new Set(paths)).sort((left, right) => left.localeCompare(right, 'en'));
}

function isMaintenanceOnlyPath(path) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    return false;
  }
  if (MAINTENANCE_ONLY_ROOT_FILES.has(path) || MAINTENANCE_ONLY_EXACT_PATHS.has(path)) return true;
  if (/^[^/]+\.md$/u.test(path)) return true;
  if (path.startsWith('.github/') || path.startsWith('.impeccable/')) return true;
  if (path.startsWith('.agents/skills/')) return true;
  if (path.startsWith('.codex/')) return true;
  if (path.startsWith('docs/')) return true;
  if (path.startsWith('scripts/git/')) return true;
  if (/^scripts\/(?:docker|release)\/.+\.test\.mjs$/u.test(path)) return true;
  return (
    path.startsWith('scripts/check/') ||
    path.startsWith('scripts/docs/') ||
    path.startsWith('scripts/test/')
  );
}

export function classifyReleaseImpact(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { releaseRequired: true, reasons: ['no changed paths were available'] };
  }

  const releasePaths = Array.from(
    new Set(paths.map(normalizeRepoPath).filter((path) => !isMaintenanceOnlyPath(path))),
  ).sort((left, right) => left.localeCompare(right, 'en'));

  return {
    releaseRequired: releasePaths.length > 0,
    reasons: releasePaths.map((path) => `release-worthy path: ${path || '<invalid>'}`),
  };
}

export function resolveReleaseSelection(labels, changedFilePayload) {
  const normalizedLabels = Array.isArray(labels)
    ? labels.map(normalizeLabelName).filter(Boolean)
    : [];
  const matchedLabels = normalizedLabels.filter((name) => RELEASE_LABEL_TO_BUMP.has(name));

  if (matchedLabels.length !== 1) {
    const found = matchedLabels.length === 0 ? 'none' : matchedLabels.join(', ');
    throw new Error(
      `Expected exactly one release label (${RELEASE_LABELS.join(', ')}), found: ${found}`,
    );
  }

  const label = matchedLabels[0];
  if (label !== 'release:none') {
    return { label, bump: RELEASE_LABEL_TO_BUMP.get(label), releaseRequired: true };
  }

  const impact = classifyReleaseImpact(flattenChangedFilePayload(changedFilePayload));
  if (impact.releaseRequired) {
    throw new Error(`release:none is not allowed: ${impact.reasons.join('; ')}`);
  }
  return { label, bump: null, releaseRequired: false };
}

import { readdirSync, readFileSync } from 'node:fs';

import {
  CONTRACT_VERSIONS,
  type VersionMetaResponse,
} from '@esl-pipeline/contracts';

const REPO_PACKAGE_JSON_URL = new URL('../../../../package.json', import.meta.url);
// The backend package and production image include this same directory for
// migration execution. Keep the expected release head tied to that artifact.
const MIGRATIONS_URL = new URL('../../migrations/', import.meta.url);
const UNKNOWN_REPO_VERSION = '0.0.0-unknown';
const DB_MIGRATION_HEAD = (() => {
  const latest = readdirSync(MIGRATIONS_URL, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{4}_[a-z0-9_]+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .at(-1);
  if (!latest) throw new Error('No backend migrations found for version metadata');
  return latest.replace(/\.sql$/, '');
})();

let cachedRepoVersion: string | null = null;

function loadRepoVersion(): string {
  if (cachedRepoVersion) {
    return cachedRepoVersion;
  }

  try {
    const raw = readFileSync(REPO_PACKAGE_JSON_URL, 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
      cachedRepoVersion = parsed.version.trim();
      return cachedRepoVersion;
    }
  } catch {
    // fall through to unknown version
  }

  cachedRepoVersion = UNKNOWN_REPO_VERSION;
  return cachedRepoVersion;
}

export function getVersionMeta(): VersionMetaResponse {
  return {
    repoVersion: loadRepoVersion(),
    contracts: {
      ...CONTRACT_VERSIONS,
      dbMigrationHead: DB_MIGRATION_HEAD,
    },
  };
}

export function resetVersionMetaCacheForTests(): void {
  cachedRepoVersion = null;
}

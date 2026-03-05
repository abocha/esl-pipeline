import { readFileSync } from 'node:fs';

import {
  CONTRACT_VERSIONS,
  DB_MIGRATION_HEAD,
  type VersionMetaResponse,
} from '@esl-pipeline/contracts';

const REPO_PACKAGE_JSON_URL = new URL('../../../../package.json', import.meta.url);
const UNKNOWN_REPO_VERSION = '0.0.0-unknown';

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

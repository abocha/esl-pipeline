import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { listProfiles } from '../domain/profile-repository.js';
import { getProfileRevisionById } from '../domain/profile-revision-repository.js';
import {
  deriveFoundationalProfileFromMarkdown,
  renderFoundationalProfileContent,
  type FoundationalProfile,
} from './foundational-profile.js';
import type { ProfileRevisionDetailResponse } from './profile-content.js';
import { saveProfileRevisionContent } from './profile-content.js';

const PROFILE_PAGE_LIMIT = 200;

export interface MigrateLegacyProfilesRequest {
  apply?: boolean;
  profileId?: string | null;
  reviewerId?: string | null;
  status?: 'draft' | 'active';
  limit?: number;
}

export interface LegacyProfileMigrationItem {
  profileId: string;
  label: string;
  sourceRevisionId: string | null;
  originalMarkdown: string | null;
  structuredContent: FoundationalProfile | null;
  renderedContent: string | null;
  action: 'planned' | 'migrated' | 'skipped';
  reason:
    | 'already_structured'
    | 'missing_active_revision'
    | 'missing_revision_content'
    | 'unable_to_derive'
    | null;
  migratedRevision: ProfileRevisionDetailResponse | null;
}

export interface MigrateLegacyProfilesResult {
  profilesScanned: number;
  migratedCount: number;
  plannedCount: number;
  skippedCount: number;
  items: LegacyProfileMigrationItem[];
}

interface LegacyProfileMigrationDependencies {
  config: BatchBackendConfig;
  profiles: {
    list: typeof listProfiles;
  };
  revisions: {
    getById: typeof getProfileRevisionById;
  };
  profileContent: {
    saveRevision: typeof saveProfileRevisionContent;
  };
}

function getDependencies(
  overrides?: Partial<LegacyProfileMigrationDependencies>,
): LegacyProfileMigrationDependencies {
  return {
    config: overrides?.config ?? loadConfig(),
    profiles: overrides?.profiles ?? {
      list: listProfiles,
    },
    revisions: overrides?.revisions ?? {
      getById: getProfileRevisionById,
    },
    profileContent: overrides?.profileContent ?? {
      saveRevision: saveProfileRevisionContent,
    },
  };
}

async function listMigrationCandidates(
  dependencies: LegacyProfileMigrationDependencies,
  request: MigrateLegacyProfilesRequest,
) {
  const items: Awaited<ReturnType<typeof dependencies.profiles.list>>['items'] = [];
  let offset = 0;
  const requestedLimit =
    typeof request.limit === 'number' && request.limit > 0 ? request.limit : Number.POSITIVE_INFINITY;

  while (items.length < requestedLimit) {
    const page = await dependencies.profiles.list({
      limit: Math.min(PROFILE_PAGE_LIMIT, requestedLimit - items.length),
      offset,
      order: 'asc',
    });
    const nextItems = request.profileId
      ? page.items.filter((profile) => profile.id === request.profileId)
      : page.items;
    items.push(...nextItems);

    if (
      page.items.length === 0 ||
      offset + page.items.length >= page.total ||
      (request.profileId && nextItems.length > 0)
    ) {
      break;
    }
    offset += page.items.length;
  }

  return items;
}

export async function migrateLegacyProfiles(args: {
  request: MigrateLegacyProfilesRequest;
  overrides?: Partial<LegacyProfileMigrationDependencies>;
}): Promise<MigrateLegacyProfilesResult> {
  const dependencies = getDependencies(args.overrides);
  const request = args.request;
  const profiles = await listMigrationCandidates(dependencies, request);
  const items: LegacyProfileMigrationItem[] = [];

  for (const profile of profiles) {
    if (!profile.activeRevisionId) {
      items.push({
        profileId: profile.id,
        label: profile.label,
        sourceRevisionId: null,
        originalMarkdown: null,
        structuredContent: null,
        renderedContent: null,
        action: 'skipped',
        reason: 'missing_active_revision',
        migratedRevision: null,
      });
      continue;
    }

    const activeRevision = await dependencies.revisions.getById(profile.id, profile.activeRevisionId);
    if (!activeRevision) {
      items.push({
        profileId: profile.id,
        label: profile.label,
        sourceRevisionId: profile.activeRevisionId,
        originalMarkdown: null,
        structuredContent: null,
        renderedContent: null,
        action: 'skipped',
        reason: 'missing_active_revision',
        migratedRevision: null,
      });
      continue;
    }

    if (activeRevision.structuredContent) {
      items.push({
        profileId: profile.id,
        label: profile.label,
        sourceRevisionId: activeRevision.id,
        originalMarkdown: activeRevision.content,
        structuredContent: activeRevision.structuredContent,
        renderedContent: renderFoundationalProfileContent(activeRevision.structuredContent),
        action: 'skipped',
        reason: 'already_structured',
        migratedRevision: null,
      });
      continue;
    }

    if (!activeRevision.content.trim()) {
      items.push({
        profileId: profile.id,
        label: profile.label,
        sourceRevisionId: activeRevision.id,
        originalMarkdown: activeRevision.content,
        structuredContent: null,
        renderedContent: null,
        action: 'skipped',
        reason: 'missing_revision_content',
        migratedRevision: null,
      });
      continue;
    }

    const structuredContent = deriveFoundationalProfileFromMarkdown(activeRevision.content);
    if (!structuredContent) {
      items.push({
        profileId: profile.id,
        label: profile.label,
        sourceRevisionId: activeRevision.id,
        originalMarkdown: activeRevision.content,
        structuredContent: null,
        renderedContent: null,
        action: 'skipped',
        reason: 'unable_to_derive',
        migratedRevision: null,
      });
      continue;
    }

    const renderedContent = renderFoundationalProfileContent(structuredContent);
    const migratedRevision = request.apply
      ? await dependencies.profileContent.saveRevision(profile.id, renderedContent, {
          source: 'legacy_normalization',
          status: request.status ?? 'draft',
          createdBy: request.reviewerId ?? null,
          dedupeByHash: false,
          structuredContent,
        })
      : null;

    items.push({
      profileId: profile.id,
      label: profile.label,
      sourceRevisionId: activeRevision.id,
      originalMarkdown: activeRevision.content,
      structuredContent,
      renderedContent,
      action: request.apply ? 'migrated' : 'planned',
      reason: null,
      migratedRevision,
    });
  }

  return {
    profilesScanned: profiles.length,
    migratedCount: items.filter((item) => item.action === 'migrated').length,
    plannedCount: items.filter((item) => item.action === 'planned').length,
    skippedCount: items.filter((item) => item.action === 'skipped').length,
    items,
  };
}

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { getActiveProfileRevision } from '../domain/profile-revision-repository.js';
import { listStudents } from '../domain/student-repository.js';
import {
  deriveFoundationalProfileFromMarkdown,
  type FoundationalProfile,
  renderFoundationalProfileContent,
} from './foundational-profile.js';
import type { ProfileRevisionDetailResponse } from './profile-content.js';
import { saveProfileRevisionContent } from './profile-content.js';

const PROFILE_PAGE_LIMIT = 200;

export interface MigrateLegacyProfilesRequest {
  apply?: boolean;
  studentId?: string | null;
  reviewerId?: string | null;
  status?: 'draft' | 'active';
  limit?: number;
}

export interface LegacyProfileMigrationItem {
  studentId: string | null;
  studentName: string | null;
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

export interface LegacyProfileMigrationReportMetadata {
  generatedAt: string;
  mode: 'dry-run' | 'apply:draft' | 'apply:active';
  filters: {
    studentId: string | null;
    reviewerId: string | null;
    limit: number | null;
  };
}

export interface LegacyProfileMigrationReport {
  metadata: LegacyProfileMigrationReportMetadata;
  summary: {
    profilesScanned: number;
    migratedCount: number;
    plannedCount: number;
    skippedCount: number;
  };
  items: LegacyProfileMigrationItem[];
}

interface LegacyProfileMigrationDependencies {
  config: BatchBackendConfig;
  students: {
    list: typeof listStudents;
  };

  revisions: {
    getById: typeof getActiveProfileRevision;
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
    students: overrides?.students ?? {
      list: listStudents,
    },

    revisions: overrides?.revisions ?? {
      getById: getActiveProfileRevision,
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
  const items: {
    studentId: string;
    studentName: string;
  }[] = [];
  let offset = 0;
  const requestedLimit =
    typeof request.limit === 'number' && request.limit > 0
      ? request.limit
      : Number.POSITIVE_INFINITY;

  while (items.length < requestedLimit) {
    const page = await dependencies.students.list({
      limit: Math.min(PROFILE_PAGE_LIMIT, requestedLimit - items.length),
      offset,
      order: 'asc',
    });
    const nextItems = page.items
      .filter((student) => !request.studentId || student.id === request.studentId)
      .map((student) => ({ studentId: student.id, studentName: student.student }));
    items.push(...nextItems);

    if (
      page.items.length === 0 ||
      offset + page.items.length >= page.total ||
      (request.studentId && nextItems.length > 0)
    ) {
      break;
    }
    offset += page.items.length;
  }

  return items;
}

function renderOptionalCodeBlock(label: string, content: string | null): string {
  if (!content) {
    return `### ${label}\n\n_None_\n`;
  }

  return `### ${label}\n\n\`\`\`md\n${content}\n\`\`\`\n`;
}

function renderStructuredProfileBlock(structuredContent: FoundationalProfile | null): string {
  if (!structuredContent) {
    return '### Structured Content\n\n_None_\n';
  }

  return `### Structured Content\n\n\`\`\`json\n${JSON.stringify(structuredContent, null, 2)}\n\`\`\`\n`;
}

function renderMigrationReason(item: LegacyProfileMigrationItem): string {
  if (!item.reason) {
    return 'none';
  }

  return item.reason.replaceAll('_', ' ');
}

export function createLegacyProfileMigrationReport(args: {
  request: MigrateLegacyProfilesRequest;
  result: MigrateLegacyProfilesResult;
  generatedAt?: string;
}): LegacyProfileMigrationReport {
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const status = args.request.status ?? 'draft';

  return {
    metadata: {
      generatedAt,
      mode: args.request.apply ? `apply:${status}` : 'dry-run',
      filters: {
        studentId: args.request.studentId ?? null,
        reviewerId: args.request.reviewerId ?? null,
        limit: typeof args.request.limit === 'number' ? args.request.limit : null,
      },
    },
    summary: {
      profilesScanned: args.result.profilesScanned,
      migratedCount: args.result.migratedCount,
      plannedCount: args.result.plannedCount,
      skippedCount: args.result.skippedCount,
    },
    items: args.result.items,
  };
}

export function renderLegacyProfileMigrationSummaryMarkdown(
  report: LegacyProfileMigrationReport,
): string {
  const lines = [
    '# Legacy Profile Migration Report',
    '',
    `- Generated at: ${report.metadata.generatedAt}`,
    `- Mode: ${report.metadata.mode}`,
    `- Target profile: ${report.metadata.filters.studentId ?? 'all student-bound profiles'}`,
    `- Limit: ${report.metadata.filters.limit ?? 'none'}`,
    `- Reviewer: ${report.metadata.filters.reviewerId ?? 'none'}`,
    '',
    '## Summary',
    '',
    `- Profiles scanned: ${report.summary.profilesScanned}`,
    `- Planned: ${report.summary.plannedCount}`,
    `- Migrated: ${report.summary.migratedCount}`,
    `- Skipped: ${report.summary.skippedCount}`,
    '',
    '## Profiles',
    '',
  ];

  if (report.items.length === 0) {
    lines.push('_No matching profiles found._');
    return `${lines.join('\n')}\n`;
  }

  for (const item of report.items) {
    lines.push(
      `- ${item.studentName ?? item.label} | \`${item.studentId}\` | action=${item.action} | sourceRevision=${item.sourceRevisionId ?? 'none'} | migratedRevision=${item.migratedRevision?.id ?? 'none'} | reason=${renderMigrationReason(item)}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export function renderLegacyProfileMigrationItemMarkdown(item: LegacyProfileMigrationItem): string {
  const lines = [
    `# ${item.label}`,
    '',
    `- Student: ${item.studentName ?? 'unknown'}${item.studentId ? ` (\`${item.studentId}\`)` : ''}`,
    `- Profile ID: \`${item.studentId}\``,
    `- Action: ${item.action}`,
    `- Source revision: ${item.sourceRevisionId ?? 'none'}`,
    `- Migrated revision: ${item.migratedRevision?.id ?? 'none'}`,
    `- Reason: ${renderMigrationReason(item)}`,
    '',
    renderStructuredProfileBlock(item.structuredContent),
    '',
    renderOptionalCodeBlock('Rendered Canonical Content', item.renderedContent),
    '',
    renderOptionalCodeBlock('Original Markdown', item.originalMarkdown),
  ];

  return `${lines.join('\n')}\n`;
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
    const activeRevision = await dependencies.revisions.getById(profile.studentId);
    if (!activeRevision) {
      items.push({
        studentId: profile.studentId,
        studentName: profile.studentName,
        label: profile.studentName,
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
    if (activeRevision.structuredContent) {
      items.push({
        studentId: profile.studentId,
        studentName: profile.studentName,
        label: profile.studentName,
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
        studentId: profile.studentId,
        studentName: profile.studentName,
        label: profile.studentName,
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
        studentId: profile.studentId,
        studentName: profile.studentName,
        label: profile.studentName,
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
      ? await dependencies.profileContent.saveRevision(profile.studentId, renderedContent, {
          source: 'legacy_normalization',
          status: request.status ?? 'draft',
          createdBy: request.reviewerId ?? null,
          dedupeByHash: false,
          structuredContent,
        })
      : null;

    items.push({
      studentId: profile.studentId,
      studentName: profile.studentName,
      label: profile.studentName,
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

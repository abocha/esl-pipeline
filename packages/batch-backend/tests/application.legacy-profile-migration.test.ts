import { describe, expect, it, vi } from 'vitest';

import {
  createLegacyProfileMigrationReport,
  migrateLegacyProfiles,
  renderLegacyProfileMigrationItemMarkdown,
  renderLegacyProfileMigrationSummaryMarkdown,
} from '../src/application/legacy-profile-migration.js';
import { loadConfig } from '../src/config/env.js';

describe('application/legacy-profile-migration', () => {
  it('plans and applies structured migrations for markdown-only active revisions', async () => {
    const saveRevision = vi.fn(async () => ({
      id: 'revision-structured-1',
      studentId: 'student-alex',
      contentHash: 'hash-2',
      source: 'legacy_normalization' as const,
      status: 'draft' as const,
      versionNumber: 2,
      versionLabel: 'v2',
      activatedAt: null,
      deprecatedAt: null,
      createdAt: '2026-04-22T00:00:00.000Z',
      createdBy: 'teacher-1',
      restoredFromRevisionId: null,
      content: '# Foundational Profile',
      structuredContent: {
        schemaVersion: 'foundational_profile_v1' as const,
        overallLevel: 'B1',
        primaryGoals: ['Lead project updates more confidently.'],
        communicationContexts: [],
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: 'Tactical Follow-ups\nReview phrasal verbs from the April 10 lesson.',
      },
    }));

    const result = await migrateLegacyProfiles({
      request: {
        apply: true,
        status: 'draft',
        reviewerId: 'teacher-1',
      },
      overrides: {
        config: loadConfig(),
        students: {
          list: async () => ({
            items: [
              {
                id: 'student-alex',
                student: 'Alex',
                dbId: null,
                pageParentId: null,
                colorPreset: null,
                voices: {},
                manifestPreset: null,
                accentPreference: null,
                archivedAt: null,
                archivedBy: null,
                archiveReason: null,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              },
            ],
            total: 1,
            limit: 200,
            offset: 0,
            order: 'asc',
          }),
        },
        revisions: {
          getById: async () => ({
            id: 'revision-legacy-1',
            studentId: 'student-alex',
            content: `# Foundational Profile
**Current Level:** B1

## Goals & Motivation
- Lead project updates more confidently.

## Tactical Follow-ups
- Review phrasal verbs from the April 10 lesson.
`,
            structuredContent: null,
            contentHash: 'hash-1',
            source: 'update',
            status: 'active',
            versionNumber: 1,
            versionLabel: 'v1',
            activatedAt: new Date('2026-04-01T00:00:00.000Z'),
            deprecatedAt: null,
            createdAt: new Date('2026-04-01T00:00:00.000Z'),
            createdBy: 'teacher-1',
            restoredFromRevisionId: null,
          }),
        },
        profileContent: {
          saveRevision,
        },
      },
    });

    expect(result.migratedCount).toBe(1);
    expect(result.plannedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        studentId: 'student-alex',
        studentName: 'Alex',
        sourceRevisionId: 'revision-legacy-1',
        action: 'migrated',
      }),
    );
    expect(result.items[0]!.structuredContent?.teacherNotes).toContain('Tactical Follow-ups');
    expect(saveRevision).toHaveBeenCalledWith(
      'student-alex',
      expect.stringContaining('# Foundational Profile'),
      expect.objectContaining({
        source: 'legacy_normalization',
        status: 'draft',
        createdBy: 'teacher-1',
        structuredContent: expect.objectContaining({
          overallLevel: 'B1',
          primaryGoals: ['Lead project updates more confidently.'],
        }),
      }),
    );
  });

  it('skips profiles whose active revision already has structured content', async () => {
    const saveRevision = vi.fn();

    const result = await migrateLegacyProfiles({
      request: {},
      overrides: {
        config: loadConfig(),
        students: {
          list: async () => ({
            items: [
              {
                id: 'student-alex',
                student: 'Alex',
                dbId: null,
                pageParentId: null,
                colorPreset: null,
                voices: {},
                manifestPreset: null,
                accentPreference: null,
                archivedAt: null,
                archivedBy: null,
                archiveReason: null,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              },
            ],
            total: 1,
            limit: 200,
            offset: 0,
            order: 'asc',
          }),
        },
        revisions: {
          getById: async () => ({
            id: 'revision-structured-1',
            studentId: 'student-alex',
            content: '# Foundational Profile',
            structuredContent: {
              schemaVersion: 'foundational_profile_v1' as const,
              overallLevel: 'B1',
              primaryGoals: [],
              communicationContexts: [],
              interestsAndUsefulThemes: [],
              stableStrengths: [],
              persistentChallenges: [],
              studyPreferences: [],
              durableConstraints: [],
              teacherNotes: null,
            },
            contentHash: 'hash-1',
            source: 'update',
            status: 'active',
            versionNumber: 1,
            versionLabel: 'v1',
            activatedAt: new Date('2026-04-01T00:00:00.000Z'),
            deprecatedAt: null,
            createdAt: new Date('2026-04-01T00:00:00.000Z'),
            createdBy: 'teacher-1',
            restoredFromRevisionId: null,
          }),
        },
        profileContent: {
          saveRevision,
        },
      },
    });

    expect(result.migratedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        action: 'skipped',
        reason: 'already_structured',
      }),
    );
    expect(saveRevision).not.toHaveBeenCalled();
  });

  it('keeps paging until it finds a targeted studentId', async () => {
    const saveRevision = vi.fn();
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        items: Array.from({ length: 200 }, (_, index) => ({
          id: `student-${index}`,
          student: `Student ${index}`,
          dbId: null,
          pageParentId: null,
          colorPreset: null,
          voices: {},
          manifestPreset: null,
          accentPreference: null,
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        })),
        total: 201,
        limit: 200,
        offset: 0,
        order: 'asc' as const,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'student-target',
            student: 'Target',
            dbId: null,
            pageParentId: null,
            colorPreset: null,
            voices: {},
            manifestPreset: null,
            accentPreference: null,
            archivedAt: null,
            archivedBy: null,
            archiveReason: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
        total: 201,
        limit: 1,
        offset: 200,
        order: 'asc' as const,
      });

    const result = await migrateLegacyProfiles({
      request: {
        studentId: 'student-target',
      },
      overrides: {
        config: loadConfig(),
        students: {
          list,
        },
        revisions: {
          getById: async () => ({
            id: 'revision-target',
            studentId: 'student-target',
            content: `# Foundational Profile
**Current Level:** B1

## Goals & Motivation
- Keep updates concise.
`,
            structuredContent: null,
            contentHash: 'hash-target',
            source: 'update',
            status: 'active',
            versionNumber: 1,
            versionLabel: 'v1',
            activatedAt: new Date('2026-04-01T00:00:00.000Z'),
            deprecatedAt: null,
            createdAt: new Date('2026-04-01T00:00:00.000Z'),
            createdBy: 'teacher-1',
            restoredFromRevisionId: null,
          }),
        },
        profileContent: {
          saveRevision,
        },
      },
    });

    expect(list).toHaveBeenCalledTimes(2);
    expect(result.profilesScanned).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        studentId: 'student-target',
        action: 'planned',
      }),
    );
  });

  it('renders migration report summaries and item detail for review artifacts', () => {
    const report = createLegacyProfileMigrationReport({
      request: {
        apply: false,
        studentId: 'student-alex',
        reviewerId: 'teacher-1',
        limit: 1,
      },
      generatedAt: '2026-04-22T12:00:00.000Z',
      result: {
        profilesScanned: 1,
        migratedCount: 0,
        plannedCount: 1,
        skippedCount: 0,
        items: [
          {
            studentId: 'student-alex',
            studentName: 'Alex',
            label: 'Alex',
            sourceRevisionId: 'revision-legacy-1',
            originalMarkdown:
              '# Foundational Profile\n\n## Goals & Motivation\n- Speak more clearly.\n',
            structuredContent: {
              schemaVersion: 'foundational_profile_v1',
              overallLevel: 'B1',
              primaryGoals: ['Speak more clearly.'],
              communicationContexts: [],
              interestsAndUsefulThemes: [],
              stableStrengths: [],
              persistentChallenges: [],
              studyPreferences: [],
              durableConstraints: [],
              teacherNotes: null,
            },
            renderedContent:
              '# Foundational Profile\n\n**Current Level:** B1\n\n## Goals & Motivation\n- Speak more clearly.\n',
            action: 'planned',
            reason: null,
            migratedRevision: null,
          },
        ],
      },
    });

    const summary = renderLegacyProfileMigrationSummaryMarkdown(report);
    const detail = renderLegacyProfileMigrationItemMarkdown(report.items[0]!);

    expect(summary).toContain('Legacy Profile Migration Report');
    expect(summary).toContain('Mode: dry-run');
    expect(summary).toContain('student-alex');
    expect(detail).toContain('Structured Content');
    expect(detail).toContain('"overallLevel": "B1"');
    expect(detail).toContain('Original Markdown');
  });

  it('skips content that cannot derive a profile instead of substituting retired catalog seed data', async () => {
    const result = await migrateLegacyProfiles({
      request: {
        studentId: 'student-dasha',
      },
      overrides: {
        config: loadConfig(),
        students: {
          list: async () => ({
            items: [
              {
                id: 'student-dasha',
                student: 'Daria',
                dbId: null,
                pageParentId: null,
                colorPreset: null,
                voices: {},
                manifestPreset: null,
                accentPreference: null,
                archivedAt: null,
                archivedBy: null,
                archiveReason: null,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              },
            ],
            total: 1,
            limit: 200,
            offset: 0,
            order: 'asc',
          }),
        },
        revisions: {
          getById: async () => ({
            id: 'revision-legacy-dasha',
            studentId: 'student-dasha',
            content: '# Minimal markdown that would not be enough on its own',
            structuredContent: null,
            contentHash: 'hash-dasha',
            source: 'update',
            status: 'active',
            versionNumber: 1,
            versionLabel: 'v1',
            activatedAt: new Date('2026-04-01T00:00:00.000Z'),
            deprecatedAt: null,
            createdAt: new Date('2026-04-01T00:00:00.000Z'),
            createdBy: 'teacher-1',
            restoredFromRevisionId: null,
          }),
        },
        profileContent: {
          saveRevision: async () => {
            throw new Error('saveRevision should not be called during dry-run');
          },
        },
      },
    });

    expect(result.items[0]).toMatchObject({
      studentName: 'Daria',
      studentId: 'student-dasha',
      action: 'skipped',
      reason: 'unable_to_derive',
      structuredContent: null,
    });
  });
});

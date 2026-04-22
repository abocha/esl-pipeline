import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config/env.js';
import { migrateLegacyProfiles } from '../src/application/legacy-profile-migration.js';

describe('application/legacy-profile-migration', () => {
  it('plans and applies structured migrations for markdown-only active revisions', async () => {
    const saveRevision = vi.fn(async () => ({
      id: 'revision-structured-1',
      profileId: 'profiles/students/alex.md',
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
        profiles: {
          list: async () => ({
            items: [
              {
                id: 'profiles/students/alex.md',
                label: 'Alex',
                activeRevisionId: 'revision-legacy-1',
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
            profileId: 'profiles/students/alex.md',
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
        profileId: 'profiles/students/alex.md',
        sourceRevisionId: 'revision-legacy-1',
        action: 'migrated',
      }),
    );
    expect(result.items[0]!.structuredContent?.teacherNotes).toContain('Tactical Follow-ups');
    expect(saveRevision).toHaveBeenCalledWith(
      'profiles/students/alex.md',
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
        profiles: {
          list: async () => ({
            items: [
              {
                id: 'profiles/students/alex.md',
                label: 'Alex',
                activeRevisionId: 'revision-structured-1',
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
            profileId: 'profiles/students/alex.md',
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

  it('keeps paging until it finds a targeted profileId', async () => {
    const saveRevision = vi.fn();
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        items: Array.from({ length: 200 }, (_, index) => ({
          id: `profiles/students/student-${index}.md`,
          label: `Student ${index}`,
          activeRevisionId: `revision-${index}`,
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
            id: 'profiles/students/target.md',
            label: 'Target',
            activeRevisionId: 'revision-target',
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
        profileId: 'profiles/students/target.md',
      },
      overrides: {
        config: loadConfig(),
        profiles: {
          list,
        },
        revisions: {
          getById: async () => ({
            id: 'revision-target',
            profileId: 'profiles/students/target.md',
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
        profileId: 'profiles/students/target.md',
        action: 'planned',
      }),
    );
  });
});

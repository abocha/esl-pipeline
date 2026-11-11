import { describe, expect, it } from 'vitest';

import { createEmptyFoundationalProfile } from '../src/application/foundational-profile.js';
import { preserveInitialProfileSeed } from '../src/application/profile-initial-enrichment.js';
import {
  deriveMaintenanceAdditions,
  maintenanceFactKey,
  type ProfileFactSource,
} from '../src/application/profile-maintenance-policy.js';
import {
  assertProfileHead,
  readProfileWritePrecondition,
} from '../src/domain/profile-write-authority.js';

function source(overrides: Partial<ProfileFactSource> = {}): ProfileFactSource {
  return {
    id: 'memory-1',
    sourceLessonId: 'lesson-1',
    sourceLessonStartedAt: '2026-10-01T10:00:00Z',
    sourceContentHash: 'hash',
    facts: [
      {
        fact: 'Works with international clients.',
        category: 'profession',
        authority: 'student_stated',
        confidence: 'high',
        reviewNeeded: false,
        evidence: [{ quote: 'I work with international clients.', speakerRole: 'student' }],
      },
    ],
    ...overrides,
  };
}

describe('deterministic profile maintenance admission', () => {
  it('admits a direct high-quality fact and never combines different observation qualities', () => {
    const original = source();
    expect(deriveMaintenanceAdditions([original], ['memory-1']).map((a) => a.field)).toEqual([
      'communicationContexts',
    ]);
    const stated = source({ facts: [{ ...original.facts[0]!, confidence: 'low' }] });
    const inferred = source({
      id: 'memory-2',
      sourceLessonId: 'lesson-1',
      facts: [{ ...original.facts[0]!, authority: 'model_inferred' }],
    });
    expect(deriveMaintenanceAdditions([stated, inferred], ['memory-2'])).toEqual([]);
  });
  it('requires two distinct completed lessons for a pattern and never counts extraction replay', () => {
    const first = source({
      facts: [
        {
          ...source().facts[0]!,
          fact: 'Strong at explaining technical ideas.',
          category: 'strength',
          authority: 'model_inferred',
        },
      ],
    });
    expect(deriveMaintenanceAdditions([first], ['memory-1'])).toEqual([]);
    expect(deriveMaintenanceAdditions([first, { ...first, id: 'replay' }], ['replay'])).toEqual([]);
    expect(
      deriveMaintenanceAdditions(
        [
          first,
          {
            ...first,
            id: 'second',
            sourceLessonId: 'lesson-2',
            sourceLessonStartedAt: '2026-10-08T10:00:00Z',
          },
        ],
        ['second'],
      ),
    ).toHaveLength(1);
    expect(
      deriveMaintenanceAdditions(
        [first, { ...first, id: 'unlinked', sourceLessonId: null }],
        ['unlinked'],
      ),
    ).toEqual([]);
  });
  it('excludes goals, constraints, review-needed facts and old-only opportunities', () => {
    for (const fact of [
      'Wants to move abroad.',
      'Has limited time for homework.',
      'Struggles under pressure.',
    ]) {
      expect(
        deriveMaintenanceAdditions(
          [source({ facts: [{ ...source().facts[0]!, fact }] })],
          ['memory-1'],
        ),
      ).toEqual([]);
    }
    expect(
      deriveMaintenanceAdditions(
        [source({ facts: [{ ...source().facts[0]!, reviewNeeded: true }] })],
        ['memory-1'],
      ),
    ).toEqual([]);
    expect(deriveMaintenanceAdditions([source()], ['different-memory'])).toEqual([]);
  });
  it('keeps Unicode identities distinct and canonical equivalents stable', () => {
    expect(maintenanceFactKey('communicationContexts', 'Живёт в Москве')).not.toBe(
      maintenanceFactKey('communicationContexts', 'Живёт в Киеве'),
    );
    expect(maintenanceFactKey('studyPreferences', 'Café')).toBe(
      maintenanceFactKey('studyPreferences', 'Cafe\u0301'),
    );
  });
  it('protects an existing seed while retaining empty-seed bootstrap behavior', () => {
    const seed = {
      ...createEmptyFoundationalProfile(),
      overallLevel: 'B1',
      primaryGoals: ['Tutor goal'],
      durableConstraints: ['Tutor constraint'],
      teacherNotes: 'Exact tutor notes',
    };
    const generated = {
      ...createEmptyFoundationalProfile(),
      overallLevel: 'C2',
      primaryGoals: ['Generated goal'],
      durableConstraints: ['Generated constraint'],
      teacherNotes: 'Generated notes',
      communicationContexts: ['Unsupported rewrite'],
    };
    const evidence = { id: 'memory-1', source_content_hash: 'hash', student_facts: source().facts };
    const result = preserveInitialProfileSeed(seed, '', true, generated, evidence);
    expect(result).toEqual({
      ...seed,
      communicationContexts: ['Works with international clients.'],
    });
    expect(
      preserveInitialProfileSeed(createEmptyFoundationalProfile(), '', true, generated, evidence),
    ).toEqual(generated);
  });
});

describe('profile write preconditions', () => {
  it('distinguishes omission, known absence and a stale active head', () => {
    expect(() => readProfileWritePrecondition({})).toThrow(
      expect.objectContaining({ code: 'profile_revision_precondition_required', status: 428 }),
    );
    expect(readProfileWritePrecondition({ expectedActiveRevisionId: null })).toBeNull();
    expect(
      readProfileWritePrecondition({
        expectedActiveRevisionId: '00000000-0000-0000-0000-000000000001',
      }),
    ).toBe('00000000-0000-0000-0000-000000000001');
    expect(() =>
      readProfileWritePrecondition({ expectedActiveRevisionId: 'not-a-uuid' }),
    ).toThrow();
    expect(() => assertProfileHead(null, 'new-head')).toThrow(
      expect.objectContaining({ code: 'profile_revision_conflict', status: 409 }),
    );
    expect(() => assertProfileHead('old', 'new')).toThrow(
      expect.objectContaining({ code: 'profile_revision_conflict' }),
    );
    expect(() => assertProfileHead('new', 'new')).not.toThrow();
  });
});

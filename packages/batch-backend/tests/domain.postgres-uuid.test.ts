import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AssignmentConfirmedSnapshotSchema } from '../src/domain/assignment-session-model.js';
import { postgresUuidSchema } from '../src/domain/postgres-uuid.js';
import { MIGRATED_PROFILE_REVISION_ID } from './fixtures/migrated-profile-revision.js';

describe('canonical PostgreSQL UUID identity', () => {
  it('accepts 0059 IDs without imposing RFC UUID variant bits or rewriting them', () => {
    const hex = createHash('md5')
      .update('abo12:22222222-2222-4222-8222-222222222222:11111111-1111-4111-8111-111111111111')
      .digest('hex');
    expect(hex.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')).toBe(
      MIGRATED_PROFILE_REVISION_ID,
    );
    expect(z.string().uuid().safeParse(MIGRATED_PROFILE_REVISION_ID).success).toBe(false);
    expect(postgresUuidSchema.parse(MIGRATED_PROFILE_REVISION_ID)).toBe(
      MIGRATED_PROFILE_REVISION_ID,
    );
    expect(postgresUuidSchema.parse(MIGRATED_PROFILE_REVISION_ID.toUpperCase())).toBe(
      MIGRATED_PROFILE_REVISION_ID.toUpperCase(),
    );
    expect(postgresUuidSchema.parse('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it.each([
    'not-a-uuid',
    '',
    MIGRATED_PROFILE_REVISION_ID.replaceAll('-', ''),
    `{${MIGRATED_PROFILE_REVISION_ID}}`,
    `${MIGRATED_PROFILE_REVISION_ID}\n`,
    ` ${MIGRATED_PROFILE_REVISION_ID}`,
    MIGRATED_PROFILE_REVISION_ID.replace('c3a1', 'g3a1'),
    null,
    123,
  ])('rejects malformed or noncanonical identity %j', (value) => {
    expect(postgresUuidSchema.safeParse(value).success).toBe(false);
  });
});

describe('confirmed assignment snapshot profile revision identity', () => {
  const snapshot = {
    student: { studentId: '22222222-2222-4222-8222-222222222222' },
    source: null,
    context: {
      teacherNotes: null,
      profileRevisionId: MIGRATED_PROFILE_REVISION_ID,
      profileRevisionHash: 'a'.repeat(64),
    },
    create: null,
  };

  it('round-trips a persisted context containing a migrated revision ID', () => {
    expect(AssignmentConfirmedSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))).toEqual(
      snapshot,
    );
    expect(
      AssignmentConfirmedSnapshotSchema.parse({
        ...snapshot,
        context: { ...snapshot.context, profileRevisionId: null, profileRevisionHash: null },
      }).context?.profileRevisionId,
    ).toBeNull();
  });

  it('rejects malformed profile revision IDs and retains strict student UUID validation', () => {
    expect(
      AssignmentConfirmedSnapshotSchema.safeParse({
        ...snapshot,
        context: { ...snapshot.context, profileRevisionId: 'not-a-uuid' },
      }).success,
    ).toBe(false);
    expect(
      AssignmentConfirmedSnapshotSchema.safeParse({
        ...snapshot,
        student: { studentId: MIGRATED_PROFILE_REVISION_ID },
      }).success,
    ).toBe(false);
  });
});

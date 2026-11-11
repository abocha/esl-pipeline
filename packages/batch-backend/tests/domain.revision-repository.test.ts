import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createEmptyFoundationalProfile,
  renderFoundationalProfileContent,
} from '../src/application/foundational-profile.js';
import {
  listProfileMaintenanceChanges,
  reconcileAutomaticProfileMaintenance,
  undoProfileMaintenanceChange,
} from '../src/domain/profile-maintenance-repository.js';
import {
  getActiveProfileRevision,
  insertProfileRevision,
  listProfileRevisions,
} from '../src/domain/profile-revision-repository.js';
import { insertCanonicalReadyStudentMemorySnapshot } from '../src/domain/student-memory-snapshot-repository.js';
import { upsertStudent } from '../src/domain/student-repository.js';
import { upsertTemplate } from '../src/domain/template-repository.js';
import {
  getActiveTemplateRevision,
  insertTemplateRevision,
  listTemplateRevisions,
} from '../src/domain/template-revision-repository.js';
import { withPgClient } from '../src/infrastructure/db.js';
import { insertLessonMemory } from './support/student-memory-fixture.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

async function resetRevisionFixtures() {
  await withPgClient(async (client) => {
    await client.query(
      `
      TRUNCATE TABLE
        students,
        student_profile_revisions,
        templates,
        template_revisions
      RESTART IDENTITY CASCADE
      `,
    );
  });
}

describe('domain/revision-repositories', () => {
  beforeAll(async () => {
    await resetRevisionFixtures();
  });

  afterAll(async () => {
    await resetRevisionFixtures();
  });

  beforeEach(async () => {
    await resetRevisionFixtures();
  });

  it('inserts a new active profile revision while deprecating the previous active revision', async () => {
    const studentId = randomUUID();
    await upsertStudent({ id: studentId, student: 'Profile under test' });

    const first = await insertProfileRevision({
      studentId,
      expectedActiveRevisionId: null,
      content: 'Version 1',
      contentHash: 'hash-v1',
      source: 'create',
      status: 'active',
    });

    const second = await insertProfileRevision({
      studentId,
      expectedActiveRevisionId: first.id,
      content: 'Version 2',
      contentHash: 'hash-v2',
      source: 'update',
      status: 'active',
    });

    expect(second.versionNumber).toBeGreaterThan(first.versionNumber);

    const active = await getActiveProfileRevision(studentId);
    expect(active?.id).toBe(second.id);

    const revisions = await listProfileRevisions({
      studentId,
      order: 'desc',
      limit: 10,
      offset: 0,
    });
    const activeCount = revisions.items.filter((item) => item.status === 'active').length;
    expect(activeCount).toBe(1);
    expect(revisions.items.find((item) => item.id === first.id)?.status).toBe('deprecated');
    expect(revisions.items.find((item) => item.id === first.id)?.activatedAt).toEqual(
      first.activatedAt,
    );
  });

  it('inserts a new active template revision while deprecating the previous active revision', async () => {
    const templateId = `template-${randomUUID()}.md`;
    await upsertTemplate({ id: templateId, label: 'Template under test', activeRevisionId: null });

    const first = await insertTemplateRevision({
      templateId,
      content: 'Template version 1',
      contentHash: 'hash-template-v1',
      source: 'create',
      status: 'active',
    });

    const second = await insertTemplateRevision({
      templateId,
      content: 'Template version 2',
      contentHash: 'hash-template-v2',
      source: 'update',
      status: 'active',
    });

    expect(second.versionNumber).toBeGreaterThan(first.versionNumber);

    const active = await getActiveTemplateRevision(templateId);
    expect(active?.id).toBe(second.id);

    const revisions = await listTemplateRevisions({
      templateId,
      order: 'desc',
      limit: 10,
      offset: 0,
    });
    const activeCount = revisions.items.filter((item) => item.status === 'active').length;
    expect(activeCount).toBe(1);
    expect(revisions.items.find((item) => item.id === first.id)?.status).toBe('deprecated');
  });
  async function maintenanceFixture(twoFacts = false) {
    const studentId = randomUUID();
    const workspaceId = randomUUID();
    await withPgClient((client) =>
      client.query("INSERT INTO workspaces(id,name) VALUES($1,'Profile test')", [workspaceId]),
    );
    await upsertStudent({ id: studentId, student: 'Maintenance learner', workspaceId });
    const profile = {
      ...createEmptyFoundationalProfile(),
      primaryGoals: ['Keep tutor goal'],
      teacherNotes: 'Keep exact tutor note',
    };
    const seed = await insertProfileRevision({
      studentId,
      expectedActiveRevisionId: null,
      content: renderFoundationalProfileContent(profile),
      contentHash: 'seed-hash',
      structuredContent: profile,
      status: 'active',
    });
    const memoryId = await insertLessonMemory({
      studentId,
      status: 'ready',
      withConfirmedSource: true,
    });
    const fact = {
      fact: 'Works with international clients.',
      category: 'profession',
      authority: 'student_stated',
      confidence: 'high',
      reviewNeeded: false,
      evidence: [{ quote: 'I work with international clients.', speakerRole: 'student' }],
    };
    await withPgClient((client) =>
      client.query('UPDATE lesson_memory_entries SET student_facts=$2::jsonb WHERE id=$1', [
        memoryId,
        JSON.stringify(
          twoFacts ? [fact, { ...fact, fact: 'Works in an international product team.' }] : [fact],
        ),
      ]),
    );
    const snapshot = await insertCanonicalReadyStudentMemorySnapshot({
      studentId,
      schemaVersion: 'student-memory.v1',
      provider: 'fixture',
      model: 'fixture',
      lessonMemoryEntryIds: [memoryId],
      generationNotes: {
        triggerSourceKind: 'lesson_memory',
        triggerSourceEntryId: memoryId,
        includedLessonMemoryEntryIds: [memoryId],
      },
    });
    const actor = await withPgClient((client) =>
      client.query<{ id: string }>(
        'SELECT user_id AS id FROM assignment_sessions WHERE student_id=$1 LIMIT 1',
        [studentId],
      ),
    );
    return {
      studentId,
      workspaceId,
      profile,
      seed,
      memoryId,
      snapshot,
      actorUserId: actor.rows[0]!.id,
    };
  }

  it('atomically applies once, selectively undoes, and keeps same evidence suppressed on replay', async () => {
    const f = await maintenanceFixture();
    expect(await reconcileAutomaticProfileMaintenance(f.studentId, f.snapshot.id)).toBe(1);
    const first = await listProfileMaintenanceChanges(f.studentId);
    expect(first.items).toHaveLength(1);
    const active = await getActiveProfileRevision(f.studentId);
    expect(active?.structuredContent).toEqual({
      ...f.profile,
      communicationContexts: ['Works with international clients.'],
    });
    expect(await reconcileAutomaticProfileMaintenance(f.studentId, f.snapshot.id)).toBe(0);
    const undone = await undoProfileMaintenanceChange({
      studentId: f.studentId,
      changeId: first.items[0]!.id,
      expectedActiveRevisionId: active!.id,
      actorUserId: f.actorUserId,
    });
    expect(undone?.profile.structuredContent).toEqual(f.profile);
    const retry = await undoProfileMaintenanceChange({
      studentId: f.studentId,
      changeId: first.items[0]!.id,
      expectedActiveRevisionId: active!.id,
      actorUserId: f.actorUserId,
    });
    expect(retry?.profile.currentRevisionId).toBe(undone?.profile.currentRevisionId);
    expect(await reconcileAutomaticProfileMaintenance(f.studentId, f.snapshot.id)).toBe(0);
    expect((await listProfileMaintenanceChanges(f.studentId)).items[0]?.status).toBe('undone');
  });

  it('allows one concurrent active writer and rejects stale or missing preconditions without mutation', async () => {
    const f = await maintenanceFixture();
    const results = await Promise.allSettled(
      ['one', 'two'].map((content) =>
        insertProfileRevision({
          studentId: f.studentId,
          expectedActiveRevisionId: f.seed.id,
          content,
          contentHash: content,
          status: 'active',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(
      insertProfileRevision({
        studentId: f.studentId,
        content: 'unchecked',
        contentHash: 'unchecked',
      }),
    ).rejects.toMatchObject({ status: 428 });
    expect((await listProfileRevisions({ studentId: f.studentId })).total).toBe(2);
  });

  it('preserves unrelated fields, blocks same-field ABA undo and rejects foreign change IDs', async () => {
    const f = await maintenanceFixture();
    await reconcileAutomaticProfileMaintenance(f.studentId, f.snapshot.id);
    const list = await listProfileMaintenanceChanges(f.studentId);
    const active = await getActiveProfileRevision(f.studentId);
    const profile = active!.structuredContent!;
    const updated = { ...profile, teacherNotes: 'New tutor note' };
    const tutor = await insertProfileRevision({
      studentId: f.studentId,
      expectedActiveRevisionId: active!.id,
      content: renderFoundationalProfileContent(updated),
      contentHash: 'tutor-note',
      structuredContent: updated,
    });
    expect((await listProfileMaintenanceChanges(f.studentId)).items[0]?.canUndo).toBe(true);
    const different = {
      ...updated,
      communicationContexts: [...updated.communicationContexts, 'Tutor addition'],
    };
    const changed = await insertProfileRevision({
      studentId: f.studentId,
      expectedActiveRevisionId: tutor.id,
      content: renderFoundationalProfileContent(different),
      contentHash: 'changed',
      structuredContent: different,
    });
    const restored = await insertProfileRevision({
      studentId: f.studentId,
      expectedActiveRevisionId: changed.id,
      content: renderFoundationalProfileContent(updated),
      contentHash: 'aba',
      structuredContent: updated,
    });
    await expect(
      undoProfileMaintenanceChange({
        studentId: f.studentId,
        changeId: list.items[0]!.id,
        expectedActiveRevisionId: restored.id,
        actorUserId: f.actorUserId,
      }),
    ).rejects.toMatchObject({ code: 'profile_change_conflict' });
    expect(
      await undoProfileMaintenanceChange({
        studentId: randomUUID(),
        changeId: list.items[0]!.id,
        expectedActiveRevisionId: null,
        actorUserId: f.actorUserId,
      }),
    ).toBeNull();
    expect((await getActiveProfileRevision(f.studentId))?.structuredContent?.teacherNotes).toBe(
      'New tutor note',
    );
  });

  it('does not apply replaced evidence or a foreign snapshot', async () => {
    const f = await maintenanceFixture();
    expect(await reconcileAutomaticProfileMaintenance(randomUUID(), f.snapshot.id)).toBe(0);
    await withPgClient((client) =>
      client.query("UPDATE lesson_memory_entries SET status='superseded' WHERE id=$1", [
        f.memoryId,
      ]),
    );
    expect(await reconcileAutomaticProfileMaintenance(f.studentId, f.snapshot.id)).toBe(0);
    expect((await listProfileMaintenanceChanges(f.studentId)).items).toHaveLength(0);
  });

  it('can undo two automatic additions in the same field one after another', async () => {
    const f = await maintenanceFixture(true);
    expect(await reconcileAutomaticProfileMaintenance(f.studentId, f.snapshot.id)).toBe(2);
    const list = await listProfileMaintenanceChanges(f.studentId);
    const first = await undoProfileMaintenanceChange({
      studentId: f.studentId,
      changeId: list.items[0]!.id,
      expectedActiveRevisionId: list.activeRevisionId,
      actorUserId: f.actorUserId,
    });
    expect(
      (await listProfileMaintenanceChanges(f.studentId)).items.find(
        (c) => c.id === list.items[1]!.id,
      )?.canUndo,
    ).toBe(true);
    const second = await undoProfileMaintenanceChange({
      studentId: f.studentId,
      changeId: list.items[1]!.id,
      expectedActiveRevisionId: first!.profile.activeRevisionId,
      actorUserId: f.actorUserId,
    });
    expect(second?.profile.structuredContent).toEqual(f.profile);
    expect((await listProfileMaintenanceChanges(f.studentId)).items.map((c) => c.status)).toEqual([
      'undone',
      'undone',
    ]);
  });

  it('returns the current head on an undo replay after newer unrelated tutor work', async () => {
    const f = await maintenanceFixture();
    await reconcileAutomaticProfileMaintenance(f.studentId, f.snapshot.id);
    const list = await listProfileMaintenanceChanges(f.studentId);
    const first = await undoProfileMaintenanceChange({
      studentId: f.studentId,
      changeId: list.items[0]!.id,
      expectedActiveRevisionId: list.activeRevisionId,
      actorUserId: f.actorUserId,
    });
    const updated = { ...f.profile, teacherNotes: 'Newer exact tutor note' };
    const current = await insertProfileRevision({
      studentId: f.studentId,
      expectedActiveRevisionId: first!.profile.activeRevisionId,
      content: renderFoundationalProfileContent(updated),
      contentHash: 'newer',
      structuredContent: updated,
    });
    const before = (await listProfileRevisions({ studentId: f.studentId })).total;
    const replay = await undoProfileMaintenanceChange({
      studentId: f.studentId,
      changeId: list.items[0]!.id,
      expectedActiveRevisionId: list.activeRevisionId,
      actorUserId: f.actorUserId,
    });
    expect(replay?.profile.currentRevisionId).toBe(current.id);
    expect(replay?.profile.activeRevisionId).toBe(current.id);
    expect(replay?.profile.structuredContent).toEqual(updated);
    expect((await listProfileRevisions({ studentId: f.studentId })).total).toBe(before);
  });

  it('keeps new maintenance tables workspace-isolated when readiness policies are enabled', async () => {
    const f = await maintenanceFixture();
    await reconcileAutomaticProfileMaintenance(f.studentId, f.snapshot.id);
    const list = await listProfileMaintenanceChanges(f.studentId);
    await undoProfileMaintenanceChange({
      studentId: f.studentId,
      changeId: list.items[0]!.id,
      expectedActiveRevisionId: list.activeRevisionId,
      actorUserId: f.actorUserId,
    });
    await withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        const role = 'profile_policy_' + randomUUID().replaceAll('-', '');
        await client.query(`CREATE ROLE ${role}`);
        await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
        await client.query(
          `GRANT SELECT ON students,workspace_memberships,student_profile_maintenance_changes,student_profile_fact_suppressions TO ${role}`,
        );
        await client.query(
          'ALTER TABLE student_profile_maintenance_changes ENABLE ROW LEVEL SECURITY',
        );
        await client.query(
          'ALTER TABLE student_profile_fact_suppressions ENABLE ROW LEVEL SECURITY',
        );
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query("SELECT set_config('app.user_id',$1,true)", [randomUUID()]);
        expect(
          (await client.query('SELECT id FROM student_profile_maintenance_changes')).rows,
        ).toHaveLength(0);
        expect(
          (await client.query('SELECT fact_key FROM student_profile_fact_suppressions')).rows,
        ).toHaveLength(0);
        await client.query("SELECT set_config('app.user_id',$1,true)", [f.actorUserId]);
        expect(
          (await client.query('SELECT id FROM student_profile_maintenance_changes')).rows,
        ).toHaveLength(1);
        expect(
          (await client.query('SELECT fact_key FROM student_profile_fact_suppressions')).rows,
        ).toHaveLength(1);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('does not grant a same-field undo exemption from the public revision source string', async () => {
    const f = await maintenanceFixture();
    await reconcileAutomaticProfileMaintenance(f.studentId, f.snapshot.id);
    const list = await listProfileMaintenanceChanges(f.studentId);
    const active = (await getActiveProfileRevision(f.studentId))!;
    const edited = { ...active.structuredContent!, communicationContexts: ['Tutor replacement'] };
    await insertProfileRevision({
      studentId: f.studentId,
      expectedActiveRevisionId: active.id,
      content: renderFoundationalProfileContent(edited),
      contentHash: 'forged-source',
      structuredContent: edited,
      source: 'maintenance_undo',
    });
    expect((await listProfileMaintenanceChanges(f.studentId)).items[0]?.canUndo).toBe(false);
    expect(list.items[0]?.canUndo).toBe(true);
  });

  it('records genuinely later evidence for reconsideration without silently restoring an undone fact', async () => {
    const f = await maintenanceFixture();
    const link = async (memoryId: string, at: string) =>
      withPgClient(async (client) => {
        const lessonId = randomUUID();
        await client.query(
          "INSERT INTO student_lessons(id,student_id,workspace_id,starts_at,timezone,duration_minutes,status,consumes_credit,title) VALUES($1,$2,$3,$4,'UTC',60,'completed',false,'Evidence lesson')",
          [lessonId, f.studentId, f.workspaceId, at],
        );
        await client.query(
          'UPDATE assignment_sessions SET lesson_id=$2 WHERE id=(SELECT assignment_session_id FROM lesson_memory_entries WHERE id=$1)',
          [memoryId, lessonId],
        );
      });
    await link(f.memoryId, '2026-10-01T10:00:00Z');
    await reconcileAutomaticProfileMaintenance(f.studentId, f.snapshot.id);
    const list = await listProfileMaintenanceChanges(f.studentId);
    await undoProfileMaintenanceChange({
      studentId: f.studentId,
      changeId: list.items[0]!.id,
      expectedActiveRevisionId: list.activeRevisionId,
      actorUserId: f.actorUserId,
    });
    const newer = await insertLessonMemory({
      studentId: f.studentId,
      status: 'ready',
      withConfirmedSource: true,
    });
    await withPgClient((client) =>
      client.query(
        "UPDATE student_profile_fact_suppressions SET suppressed_at='2026-10-02T10:00:00Z',source_latest_lesson_at='2026-10-02T10:00:00Z' WHERE student_id=$1",
        [f.studentId],
      ),
    );
    await link(newer, '2026-10-08T10:00:00Z');
    await withPgClient((client) =>
      client.query(
        'UPDATE lesson_memory_entries SET student_facts=(SELECT student_facts FROM lesson_memory_entries WHERE id=$2) WHERE id=$1',
        [newer, f.memoryId],
      ),
    );
    const snapshot = await insertCanonicalReadyStudentMemorySnapshot({
      studentId: f.studentId,
      schemaVersion: 'student-memory.v1',
      provider: 'fixture',
      model: 'fixture',
      lessonMemoryEntryIds: [f.memoryId, newer],
      generationNotes: {
        triggerSourceKind: 'lesson_memory',
        triggerSourceEntryId: newer,
        includedLessonMemoryEntryIds: [f.memoryId, newer],
      },
    });
    expect(await reconcileAutomaticProfileMaintenance(f.studentId, snapshot.id)).toBe(0);
    expect(
      (await listProfileMaintenanceChanges(f.studentId)).items[0]?.reconsiderationAvailable,
    ).toBe(true);
    expect((await getActiveProfileRevision(f.studentId))?.structuredContent).toEqual(f.profile);
  });

  it('rolls back an active revision when change-ledger publication fails', async () => {
    const f = await maintenanceFixture();
    const trigger = 'profile_test_failure_' + randomUUID().replaceAll('-', '');
    await withPgClient(async (client) => {
      await client.query(
        `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture ledger failure'; END $$`,
      );
      await client.query(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON student_profile_maintenance_changes FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
      );
    });
    try {
      await expect(
        reconcileAutomaticProfileMaintenance(f.studentId, f.snapshot.id),
      ).rejects.toThrow('fixture ledger failure');
      expect((await getActiveProfileRevision(f.studentId))?.id).toBe(f.seed.id);
      expect((await listProfileRevisions({ studentId: f.studentId })).total).toBe(1);
      expect((await listProfileMaintenanceChanges(f.studentId)).items).toHaveLength(0);
    } finally {
      await withPgClient(async (client) => {
        await client.query(`DROP TRIGGER ${trigger} ON student_profile_maintenance_changes`);
        await client.query(`DROP FUNCTION ${trigger}()`);
      });
    }
  });

  it('never re-adds a future tutor-removed allowed-field fact without an automatic ledger origin', async () => {
    const f = await maintenanceFixture();
    const manual = { ...f.profile, communicationContexts: ['Works with international clients.'] };
    const added = await insertProfileRevision({
      studentId: f.studentId,
      expectedActiveRevisionId: f.seed.id,
      content: renderFoundationalProfileContent(manual),
      contentHash: 'manual-add',
      structuredContent: manual,
    });
    await insertProfileRevision({
      studentId: f.studentId,
      expectedActiveRevisionId: added.id,
      content: renderFoundationalProfileContent(f.profile),
      contentHash: 'manual-remove',
      structuredContent: f.profile,
    });
    expect(await reconcileAutomaticProfileMaintenance(f.studentId, f.snapshot.id)).toBe(0);
    expect((await listProfileMaintenanceChanges(f.studentId)).items).toHaveLength(0);
    expect((await getActiveProfileRevision(f.studentId))?.structuredContent).toEqual(f.profile);
    const tombstone = await withPgClient((client) =>
      client.query(
        'SELECT change_id,reason FROM student_profile_fact_suppressions WHERE student_id=$1',
        [f.studentId],
      ),
    );
    expect(tombstone.rows).toEqual([{ change_id: null, reason: 'tutor_removed_value' }]);
  });
});

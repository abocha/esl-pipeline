import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initializeStudentProfileDraft } from '../src/application/initialize-student-profile-draft.js';
import { createStudentProfile } from '../src/application/student-profiles-store.js';
import { getStudentTeachingContext } from '../src/application/student-teaching-context.js';
import { loadConfig } from '../src/config/env.js';
import {
  activateProfileRevision,
  getProfileRevisionById,
} from '../src/domain/profile-revision-repository.js';
import {
  getStudentProfileCandidateById,
  insertStudentProfileCandidate,
} from '../src/domain/student-profile-candidate-repository.js';
import { createAuthService } from '../src/infrastructure/auth-service.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import {
  authenticate,
  configureAuthMiddleware,
  resetAuthMiddlewareForTests,
} from '../src/transport/auth-middleware.js';
import type { ExtendedRoutesContext } from '../src/transport/extended-routes/context.js';
import { registerStudentRoutes } from '../src/transport/extended-routes/students-routes.js';
import { MIGRATED_PROFILE_REVISION_ID } from './fixtures/migrated-profile-revision.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

const authService = createAuthService({
  jwtSecret: 'student-area-test-key-with-adequate-length',
  jwtExpiresIn: '15m',
  refreshTokenExpiresIn: '7d',
  bcryptRounds: 4,
});
const app = Fastify({ logger: false });

async function seedTenant(mappedRevisionId?: string) {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const email = `${userId}@example.test`;
  await withPgClient(async (client) => {
    await client.query(
      "INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'unused', 'user')",
      [userId, email],
    );
    await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, email]);
    await client.query(
      "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
      [workspaceId, userId],
    );
  });
  const student = await createStudentProfile({ student: email, workspaceId });
  const initialized = await initializeStudentProfileDraft({
    request: { studentId: student.id, reviewerId: userId },
  });
  const revisionId = mappedRevisionId ?? initialized.draftRevision.id;
  if (mappedRevisionId) {
    // Synthetic PostgreSQL fixture only: prove the same identity shape as 0059
    // persists and round-trips without RFC variant bits.
    await withPgClient((client) =>
      client.query('UPDATE student_profile_revisions SET id = $2::uuid WHERE id = $1::uuid', [
        initialized.draftRevision.id,
        revisionId,
      ]),
    );
  }
  await activateProfileRevision(student.id, revisionId);
  const candidate = await insertStudentProfileCandidate({
    studentId: student.id,
    targetSection: 'goals_motivation',
    candidateKey: 'goal:confidence',
    fact: 'Wants more confidence at work.',
    category: 'goal',
    authority: 'student_stated',
    confidence: 'high',
    reviewNeeded: false,
  });
  return {
    userId,
    workspaceId,
    studentId: student.id,
    candidateId: candidate.id,
    revisionId,
    headers: {
      authorization: `Bearer ${authService.generateTokens(userId, email, 'user').accessToken}`,
    },
  };
}

type Tenant = Awaited<ReturnType<typeof seedTenant>>;
let tenantA: Tenant;
let tenantB: Tenant;

const readPaths = [
  'surfaces/overview',
  'surfaces/learning',
  'surfaces/history',
  'profile-candidates',
  'memory',
  'memory/health',
  'lesson-memory',
  'homework-memory',
  'memory-snapshots',
  'profile',
  'profile/revisions',
  'timeline',
];

function mutationPaths(candidateId: string) {
  return [
    ...['approve', 'reject', 'defer'].map((action) => ({
      path: `profile-candidates/${candidateId}/${action}`,
      payload: {},
    })),
    { path: 'profile-candidates/promote', payload: { candidateIds: [candidateId] } },
    {
      path: 'profile-drafts/refresh-from-approved-candidates',
      payload: { candidateIds: [candidateId] },
    },
    { path: 'profile-drafts/initialize', payload: {} },
    { path: 'profile/revisions', payload: { content: 'Attacker draft' } },
    { path: `profile/revisions/${randomUUID()}/activate`, payload: {} },
    { path: `profile/revisions/${randomUUID()}/restore`, payload: {} },
  ];
}

// This spy calls the real PostgreSQL driver. Inspect statements as well as responses:
// a late 404 after secondary reads must fail, even if no foreign rows were returned.
function observeQueries() {
  const spy = vi.spyOn(Client.prototype, 'query');
  return {
    spy,
    statements: () => spy.mock.calls.map(([query]) => query),
    assertOnlyStudentLookup(studentId: string, workspaceId: string, includesMembership = true) {
      const calls = spy.mock.calls;
      expect(calls).toHaveLength(includesMembership ? 2 : 1);
      expect(calls.slice(0, -1).map(([sql]) => sql)).toEqual(
        includesMembership ? [expect.stringMatching(/FROM workspace_memberships/)] : [],
      );
      const [sql, values] = calls.at(-1)!;
      expect(sql).toMatch(/FROM students/);
      expect(sql).toMatch(/workspace_id = \$3::uuid/);
      expect(values).toEqual([studentId, false, workspaceId]);
    },
  };
}

describe('student-area authorization before student-owned reads', () => {
  beforeAll(async () => {
    configureAuthMiddleware(authService);
    // Only authenticate/config are used by this route registrar.
    registerStudentRoutes(app, { authenticate, config: loadConfig() } as ExtendedRoutesContext);
    await app.ready();
    tenantA = await seedTenant();
    tenantB = await seedTenant(MIGRATED_PROFILE_REVISION_ID);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
    resetAuthMiddlewareForTests();
    // Delete only this suite's fixtures; never truncate a developer database.
    if (tenantA && tenantB)
      await withPgClient(async (client) => {
        await client.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [
          [tenantA.studentId, tenantB.studentId],
        ]);

        await client.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [
          [tenantA.workspaceId, tenantB.workspaceId],
        ]);
        await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
          [tenantA.userId, tenantB.userId],
        ]);
      });
    await closePgPool();
  });

  it('denies every affected GET and POST before any secondary SQL, identically for foreign and missing students', async () => {
    const queries = observeQueries();
    try {
      const routes = [
        ...readPaths.map((path) => ({ method: 'GET' as const, path, payload: undefined })),
        ...mutationPaths(tenantB.candidateId).map((route) => ({
          method: 'POST' as const,
          ...route,
        })),
      ];
      for (const route of routes) {
        for (const studentId of [tenantB.studentId, randomUUID()]) {
          queries.spy.mockClear();
          const response = await app.inject({
            method: route.method,
            url: `/students/${studentId}/${route.path}`,
            headers: tenantA.headers,
            payload: route.payload,
          });
          expect(response.statusCode, `${route.method} ${route.path}`).toBe(404);
          expect(response.json()).toEqual({ error: 'not_found' });
          queries.assertOnlyStudentLookup(studentId, tenantA.workspaceId);
        }
      }
    } finally {
      queries.spy.mockRestore();
    }
  });

  it('rejects malformed student identifiers without secondary SQL', async () => {
    const queries = observeQueries();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/students/not-a-uuid/profile',
        headers: tenantA.headers,
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
      expect(queries.spy).not.toHaveBeenCalled();
    } finally {
      queries.spy.mockRestore();
    }
  });

  it('authenticates before resolving workspace or student', async () => {
    const queries = observeQueries();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/students/${tenantB.studentId}/memory`,
      });
      expect(response.statusCode).toBe(401);
      expect(queries.spy).not.toHaveBeenCalled();
    } finally {
      queries.spy.mockRestore();
    }
  });

  it('allows both tutors to read their own profile and surfaces, and protects initialized history', async () => {
    for (const tenant of [tenantA, tenantB]) {
      const initialized = await app.inject({
        method: 'POST',
        url: `/students/${tenant.studentId}/profile-drafts/initialize`,
        headers: tenant.headers,
      });
      expect(initialized.statusCode, initialized.body).toBe(409);
      expect(initialized.json().error).toBe('profile_already_initialized');
      for (const path of readPaths) {
        const response = await app.inject({
          method: 'GET',
          url: `/students/${tenant.studentId}/${path}`,
          headers: tenant.headers,
        });
        expect(response.statusCode, `${path}: ${response.body}`).toBe(200);
      }
      const detail = await app.inject({
        method: 'GET',
        url: `/students/${tenant.studentId}/profile/revisions/${tenant.revisionId}`,
        headers: tenant.headers,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ id: tenant.revisionId, studentId: tenant.studentId });
    }
  });

  it('keeps candidate review SQL scoped to the authorized student and cannot mutate a foreign candidate', async () => {
    const before = await getStudentProfileCandidateById(tenantB.studentId, tenantB.candidateId);
    for (const action of ['approve', 'reject', 'defer']) {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${tenantA.studentId}/profile-candidates/${tenantB.candidateId}/${action}`,
        headers: tenantA.headers,
        payload: {},
      });
      expect(response.statusCode).toBe(404);
      const missing = await app.inject({
        method: 'POST',
        url: `/students/${tenantA.studentId}/profile-candidates/${randomUUID()}/${action}`,
        headers: tenantA.headers,
        payload: {},
      });
      expect(response.json()).toEqual(missing.json());
    }
    expect(await getStudentProfileCandidateById(tenantB.studentId, tenantB.candidateId)).toEqual(
      before,
    );
    const approved = await app.inject({
      method: 'POST',
      url: `/students/${tenantA.studentId}/profile-candidates/${tenantA.candidateId}/approve`,
      headers: tenantA.headers,
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ studentId: tenantA.studentId, status: 'approved' });
  });

  it('rejects foreign candidate selections and foreign base revisions without writing drafts or candidate links', async () => {
    const queries = observeQueries();
    try {
      for (const path of [
        'profile-candidates/promote',
        'profile-drafts/refresh-from-approved-candidates',
      ]) {
        for (const payload of [
          { candidateIds: [tenantB.candidateId] },
          { candidateIds: [tenantA.candidateId], baseRevisionId: tenantB.revisionId },
        ]) {
          queries.spy.mockClear();
          const response = await app.inject({
            method: 'POST',
            url: `/students/${tenantA.studentId}/${path}`,
            headers: tenantA.headers,
            payload,
          });
          expect(response.statusCode, response.body).toBe(404);
          expect(
            queries.statements().some((sql) => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql)),
          ).toBe(false);
          // Secondary candidate/revision lookups must include the authorized parent,
          // not load a foreign child globally and compare its owner afterward.
          for (const [sql, values] of queries.spy.mock.calls.filter(([sql]) =>
            /FROM student_profile_candidates/.test(sql),
          )) {
            expect(sql).toMatch(/student_id = \$1/);
            expect(values?.[0]).toBe(tenantA.studentId);
          }
          const revisionQueries = queries.spy.mock.calls.filter(([sql]) =>
            /FROM student_profile_revisions/.test(sql),
          );
          expect(revisionQueries.length).toBeGreaterThan(0);
          for (const [sql, values] of revisionQueries) {
            expect(sql).toMatch(/student_id = \$1/);
            expect(values?.[0]).toBe(tenantA.studentId);
          }
        }
      }
    } finally {
      queries.spy.mockRestore();
    }
  });

  it('retains teaching_context.v1 SQL ownership ordering and same-workspace access', async () => {
    const queries = observeQueries();
    try {
      expect(
        await getStudentTeachingContext({
          workspaceId: tenantA.workspaceId,
          studentId: tenantB.studentId,
        }),
      ).toBeNull();
      queries.assertOnlyStudentLookup(tenantB.studentId, tenantA.workspaceId, false);
      queries.spy.mockClear();
      const context = await getStudentTeachingContext({
        workspaceId: tenantA.workspaceId,
        studentId: tenantA.studentId,
      });
      expect(context?.schemaVersion).toBe('teaching_context.v1');
      expect(context?.student.id).toBe(tenantA.studentId);
      expect(queries.statements()[0]).toMatch(/FROM students/);
      expect(
        queries
          .statements()
          .slice(1)
          .some((sql) => /FROM student_profile_revisions/.test(sql)),
      ).toBe(true);
    } finally {
      queries.spy.mockRestore();
    }
  });
  it('scopes all revision reads and mutations to the parent, including another student in the same workspace', async () => {
    const sibling = await createStudentProfile({
      student: `Sibling ${randomUUID()}`,
      workspaceId: tenantA.workspaceId,
    });
    const initialized = await initializeStudentProfileDraft({
      request: { studentId: sibling.id, reviewerId: tenantA.userId },
    });
    const foreignRevision = initialized.draftRevision.id;
    try {
      for (const revisionId of [foreignRevision, tenantB.revisionId, randomUUID()]) {
        for (const action of ['', '/activate', '/restore']) {
          const response = await app.inject({
            method: action ? 'POST' : 'GET',
            url: `/students/${tenantA.studentId}/profile/revisions/${revisionId}${action}`,
            headers: tenantA.headers,
          });
          expect(response.statusCode, response.body).toBe(404);
          expect(response.json()).toEqual({ error: 'not_found' });
        }
        const before = await app.inject({
          method: 'GET',
          url: `/students/${tenantA.studentId}/profile/revisions`,
          headers: tenantA.headers,
        });
        const response = await app.inject({
          method: 'POST',
          url: `/students/${tenantA.studentId}/profile/revisions`,
          headers: tenantA.headers,
          payload: {
            content: 'Unauthorized inheritance',
            status: 'draft',
            inheritCandidateLinksFromRevisionId: revisionId,
          },
        });
        expect(response.statusCode).toBe(404);
        const after = await app.inject({
          method: 'GET',
          url: `/students/${tenantA.studentId}/profile/revisions`,
          headers: tenantA.headers,
        });
        expect(after.json().total).toBe(before.json().total);
      }
      expect((await getProfileRevisionById(sibling.id, foreignRevision))?.status).toBe('draft');
    } finally {
      await withPgClient((client) =>
        client.query('DELETE FROM students WHERE id = $1', [sibling.id]),
      );
    }
  });

  it('edits, drafts, activates and restores independent history for an authorized student', async () => {
    const base = `/students/${tenantA.studentId}/profile`;
    const original = await getProfileRevisionById(tenantA.studentId, tenantA.revisionId);
    const edited = await app.inject({
      method: 'PUT',
      url: base,
      headers: tenantA.headers,
      payload: { content: 'Tutor edit' },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({ studentId: tenantA.studentId, content: 'Tutor edit' });
    const drafted = await app.inject({
      method: 'POST',
      url: `${base}/revisions`,
      headers: tenantA.headers,
      payload: { content: 'Proposed draft', status: 'draft' },
    });
    expect(drafted.statusCode, drafted.body).toBe(201);
    const draft = drafted.json();
    expect(draft).toMatchObject({
      studentId: tenantA.studentId,
      status: 'draft',
      createdBy: tenantA.userId,
    });
    expect(
      (await app.inject({ method: 'GET', url: base, headers: tenantA.headers })).json().content,
    ).toBe('Tutor edit');
    const activated = await app.inject({
      method: 'POST',
      url: `${base}/revisions/${draft.id}/activate`,
      headers: tenantA.headers,
    });
    expect(activated.statusCode, activated.body).toBe(200);
    const restored = await app.inject({
      method: 'POST',
      url: `${base}/revisions/${tenantA.revisionId}/restore`,
      headers: tenantA.headers,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const restoredRevision = await getProfileRevisionById(
      tenantA.studentId,
      restored.json().currentRevisionId,
    );
    expect(restoredRevision).toMatchObject({
      restoredFromRevisionId: tenantA.revisionId,
      contentHash: original?.contentHash,
      content: original?.content,
      status: 'active',
    });
    expect(restoredRevision?.id).not.toBe(original?.id);
    expect((await getProfileRevisionById(tenantA.studentId, tenantA.revisionId))?.content).toBe(
      original?.content,
    );
  });
});

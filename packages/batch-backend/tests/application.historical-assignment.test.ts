import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config/env.js';
import type { AssignmentSessionRecord } from '../src/domain/assignment-session-model.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  get: vi.fn(),
  canonical: vi.fn(),
  generate: vi.fn(),
}));
vi.mock('../src/infrastructure/db.js', () => ({
  withPgClient: (fn: (client: { query: typeof mocks.query }) => unknown) =>
    fn({ query: mocks.query }),
}));
vi.mock('../src/domain/assignment-session-repository.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/domain/assignment-session-repository.js')>()),
  getAssignmentSessionByIdForUser: mocks.get,
  isAssignmentConfirmedSourceCanonical: mocks.canonical,
}));
vi.mock('../src/application/request-lesson-memory-generation.js', () => ({
  requestLessonMemoryGeneration: mocks.generate,
}));

import { getAssignmentSessionForUser } from '../src/application/assignment-sessions.js';
import {
  HistoricalAssignmentReadOnlyError,
  isHistoricalAssignmentSession,
} from '../src/application/historical-assignment.js';
import { processHomeworkMemoryJob } from '../src/application/process-homework-memory-job.js';

function session() {
  return {
    id: 'history',
    userId: 'owner',
    studentId: 'student',
    draftId: 'legacy-draft',
    promptPackageId: 'prompt',
    confirmed: {
      student: { studentId: 'student' },
      source: { recordingId: 'recording', transcriptId: 'transcript' },
      context: null,
      create: { artifact: { format: 'assignment_v1' }, draftId: 'frozen-typed-draft' },
    },
    createdAt: new Date('2026-10-01'),
    updatedAt: new Date('2026-10-01'),
  } as unknown as AssignmentSessionRecord;
}
beforeEach(() => vi.clearAllMocks());
describe('historical assignment boundaries', () => {
  it('checks working legacy pointers even when the confirmed snapshot is typed', async () => {
    mocks.query.mockResolvedValue({ rows: [{ historical: true }] });
    expect(await isHistoricalAssignmentSession(session())).toBe(true);
    expect(mocks.query).toHaveBeenCalledWith(expect.any(String), ['legacy-draft', 'prompt']);
  });
  it('returns the original historical snapshot without a lesson-memory replay', async () => {
    const original = session();
    mocks.get.mockResolvedValue(original);
    mocks.query.mockResolvedValue({ rows: [{ historical: true }] });
    const result = await getAssignmentSessionForUser('owner', 'history', loadConfig());
    expect(result).toMatchObject({
      id: 'history',
      historicalReadOnly: true,
      confirmed: original.confirmed,
    });
    expect(mocks.canonical).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('does not reconcile a superseded historical homework delivery into a new snapshot', async () => {
    const refresh = vi.fn(),
      generate = vi.fn();
    await processHomeworkMemoryJob({
      config: loadConfig(),
      payload: {
        kind: 'homework-memory-generate',
        jobId: 'legacy',
        studentId: 'student',
        pendingEntryId: 'pending',
        provider: 'openai',
        model: 'offline',
      },
      overrides: {
        sourceResolver: vi.fn().mockRejectedValue(new HistoricalAssignmentReadOnlyError()),
        generator: generate,
        homeworkMemory: {
          getById: vi.fn().mockResolvedValue({
            status: 'superseded',
            jobId: 'legacy',
            studentId: 'student',
            supersededById: 'ready',
          }),
          getLatestReadyByAssignmentLineageKey: vi.fn(),
          markFailed: vi.fn(),
          supersedePendingForAssignmentLineage: vi.fn(),
        },
        snapshots: { requestRefresh: refresh },
      },
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});

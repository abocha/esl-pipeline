import { describe, expect, it, vi } from 'vitest';

import { reconcileUploadCandidates } from '../src/application/reconcile-upload-candidates.js';

const localCandidate = {
  operationId: 'operation-local',
  attemptToken: 'attempt-local',
  uri: 'local://candidate-safe',
};
const s3Candidate = {
  operationId: 'operation-s3',
  attemptToken: 'attempt-s3',
  uri: 's3://bucket/candidate-adopted',
};

describe('reconcile upload candidates', () => {
  it('rechecks durable truth before each bounded idempotent deletion', async () => {
    const deleteCandidate = vi.fn(async () => undefined);
    const recordResult = vi.fn(async () => undefined);
    const deleted = await reconcileUploadCandidates({
      limit: 2,
      candidates: {
        list: async (limit) => {
          expect(limit).toBe(2);
          return [localCandidate, s3Candidate];
        },
        deletable: async (candidate) => candidate.uri === localCandidate.uri,
        recordResult,
      },
      storageForUri: () => ({ delete: deleteCandidate }) as never,
    });

    expect(deleted).toBe(1);
    expect(deleteCandidate).toHaveBeenCalledTimes(1);
    expect(deleteCandidate).toHaveBeenCalledWith(localCandidate.uri);
    expect(recordResult).toHaveBeenCalledWith({ candidate: localCandidate, deleted: true });
  });

  it('records failed deletion for durable retry before a later successful pass', async () => {
    const deleteCandidate = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);
    const candidates = {
      list: async () => [s3Candidate],
      deletable: async () => true,
      recordResult: vi.fn(async () => undefined),
    };
    const storageForUri = () => ({ delete: deleteCandidate }) as never;

    await expect(reconcileUploadCandidates({ candidates, storageForUri, limit: 1 })).resolves.toBe(
      0,
    );
    await expect(reconcileUploadCandidates({ candidates, storageForUri, limit: 1 })).resolves.toBe(
      1,
    );
    expect(deleteCandidate).toHaveBeenCalledTimes(2);
    expect(candidates.recordResult).toHaveBeenNthCalledWith(1, {
      candidate: s3Candidate,
      deleted: false,
    });
    expect(candidates.recordResult).toHaveBeenNthCalledWith(2, {
      candidate: s3Candidate,
      deleted: true,
    });
  });

  it('routes each bounded cleanup candidate through its filesystem or S3 storage owner', async () => {
    const localDelete = vi.fn(async () => undefined);
    const s3Delete = vi.fn(async () => undefined);
    const recordResult = vi.fn(async () => undefined);

    await expect(
      reconcileUploadCandidates({
        limit: 2,
        candidates: {
          list: async () => [localCandidate, s3Candidate],
          deletable: async () => true,
          recordResult,
        },
        storageForUri: (uri) =>
          ({ delete: uri.startsWith('local://') ? localDelete : s3Delete }) as never,
      }),
    ).resolves.toBe(2);

    expect(localDelete).toHaveBeenCalledWith(localCandidate.uri);
    expect(s3Delete).toHaveBeenCalledWith(s3Candidate.uri);
    expect(recordResult).toHaveBeenCalledTimes(2);
  });
});

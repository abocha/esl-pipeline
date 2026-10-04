import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assignmentFixture } from './assignment-v1.test-harness.js';

const mocks = vi.hoisted(() => ({ query: vi.fn(), read: vi.fn() }));
vi.mock('../src/infrastructure/db.js', () => ({
  withPgClient: (fn: (client: { query: typeof mocks.query }) => unknown) =>
    fn({ query: mocks.query }),
}));
vi.mock('../src/application/assignment-artifact.js', () => ({
  readAssignmentArtifact: mocks.read,
}));

import { resolveHomeworkMemorySourceFromSucceededJob } from '../src/application/homework-memory-source.js';

const artifact = {
  format: 'assignment_v1',
  schemaVersion: 1,
  serializationVersion: 1,
  storageUri: `s3://evidence/content/${'a'.repeat(64)}.json`,
  workingVersion: 1,
  contentHash: 'a'.repeat(64),
};
function row(overrides = {}) {
  return {
    id: 'job-1',
    student_id: 'student-1',
    prompt_package_id: 'prompt-1',
    assignment_artifact: artifact,
    finished_at: new Date('2026-10-04'),
    updated_at: new Date('2026-10-04'),
    state: 'succeeded',
    publish_target: 'html',
    html_url: 'https://example.test/static-history.html',
    ...overrides,
  };
}
beforeEach(() => vi.clearAllMocks());
describe('homework memory source authority', () => {
  it('rejects historical Markdown before source reads or lineage processing', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [row({ assignment_artifact: null, md_storage_uri: 's3://history/original.md' })],
    });
    await expect(resolveHomeworkMemorySourceFromSucceededJob('job-1')).rejects.toMatchObject({
      code: 'legacy_assignment_read_only',
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('reads frozen typed authority and joins only matching typed publication history', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [{ id: 'job-1' }] })
      .mockResolvedValueOnce({
        rows: [
          row({
            id: 'rerun-2',
            finished_at: new Date('2026-10-05'),
            html_url: 'https://example.test/new.html',
          }),
          row({ id: 'legacy', assignment_artifact: null }),
        ],
      });
    mocks.read.mockResolvedValue(assignmentFixture());
    const source = await resolveHomeworkMemorySourceFromSucceededJob('job-1');
    expect(mocks.read).toHaveBeenCalledWith(artifact, 'prompt-1');
    expect(source.format).toBe('assignment_v1');
    expect(source.assignment).toEqual(assignmentFixture());
    expect(source.publishTargets[0]?.jobId).toBe('rerun-2');
    expect(source).not.toHaveProperty('publishedMarkdown');
    expect(source).not.toHaveProperty('normalizedMarkdown');
  });
});

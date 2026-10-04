import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTypedJobPublication } from '../src/application/job-publication.js';
import type { JobRecord } from '../src/domain/job-model.js';
import { assignmentFixture } from './assignment-v1.test-harness.js';

vi.mock('../src/application/assignment-artifact.js', () => ({ readAssignmentArtifact: vi.fn() }));
vi.mock('../src/infrastructure/transcription-storage.js', () => ({
  createTranscriptionStorageForUri: vi.fn(),
}));

import { readAssignmentArtifact } from '../src/application/assignment-artifact.js';
import { createTranscriptionStorageForUri } from '../src/infrastructure/transcription-storage.js';

const job = {
  assignmentArtifact: { contentHash: 'hash' },
  promptPackageId: 'p',
  manifestPath: 's3://bucket/manifest.json',
} as JobRecord;
afterEach(() => vi.clearAllMocks());

describe('typed publication metadata', () => {
  it.each([
    {
      schemaVersion: 6,
      assignmentHash: 'hash',
      publication: { rendererVersion: 2 },
      audioArtifacts: {
        studyText: { url: 'https://audio/study' },
        pronunciation: {
          primaryClip: { url: 'https://audio/main' },
          itemClips: [{ url: 'https://audio/item' }],
        },
      },
    },
    {
      schemaVersion: 5,
      audioArtifacts: {
        studyText: { url: 'https://audio/study' },
        pronunciationShadowSentence: { url: 'https://audio/main' },
      },
    },
    {
      audio: { url: 'https://audio/study' },
      audioArtifacts: { pronunciationShadowSentence: { url: 'https://audio/main' } },
    },
  ])('reads versioned and historical manifests without textual scraping', async (manifest) => {
    vi.mocked(readAssignmentArtifact).mockResolvedValue(assignmentFixture());
    const read = vi.fn().mockResolvedValue(JSON.stringify(manifest));
    vi.mocked(createTranscriptionStorageForUri).mockReturnValue({ getText: read } as never);
    const result = await getTypedJobPublication(job);
    expect(result).toMatchObject({
      publication: {
        schemaVersion: 1,
        rendererVersion: 'publication' in manifest ? 2 : 1,
        title: assignmentFixture().metadata.title,
        icon: '🎧',
        studyTextAudioUrl: 'https://audio/study',
        pronunciationAudioUrl: 'https://audio/main',
      },
      pronunciationMode: 'shadow_sentence',
    });
    expect(read).toHaveBeenCalledWith(job.manifestPath);
  });
  it('preserves absent main audio for item-only manifests and rejects mismatched assignment identity', async () => {
    vi.mocked(readAssignmentArtifact).mockResolvedValue(assignmentFixture());
    const read = vi.fn().mockResolvedValue(
      JSON.stringify({
        audioArtifacts: { pronunciation: { itemClips: [{ url: 'https://audio/item' }] } },
      }),
    );
    vi.mocked(createTranscriptionStorageForUri).mockReturnValue({ getText: read } as never);
    expect((await getTypedJobPublication(job))?.publication.pronunciationAudioUrl).toBeNull();
    read.mockResolvedValue(JSON.stringify({ assignmentHash: 'different' }));
    await expect(getTypedJobPublication(job)).rejects.toThrow('identity mismatch');
  });
  it('does not share retained pronunciation audio when the typed handout has no pronunciation', async () => {
    const assignment = assignmentFixture();
    assignment.pronunciation = null;
    vi.mocked(readAssignmentArtifact).mockResolvedValue(assignment);
    const read = vi.fn().mockResolvedValue(
      JSON.stringify({
        audioArtifacts: { pronunciation: { primaryClip: { url: 'https://audio/retained' } } },
      }),
    );
    vi.mocked(createTranscriptionStorageForUri).mockReturnValue({ getText: read } as never);
    expect((await getTypedJobPublication(job))?.publication.pronunciationAudioUrl).toBeNull();
  });

  it('does not reinterpret a legacy job as typed', async () => {
    expect(await getTypedJobPublication({ md: '/legacy.md' } as JobRecord)).toBeNull();
    expect(readAssignmentArtifact).not.toHaveBeenCalled();
  });
});

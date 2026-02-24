import { describe, expect, it } from 'vitest';

import { jobRecordToDto } from '../src/application/job-dto.js';
import type { JobRecord } from '../src/domain/job-model.js';

describe('application/job-dto', () => {
  it('serializes JobRecord fields with ISO timestamps', () => {
    const job: JobRecord = {
      id: 'job-1',
      state: 'succeeded',
      md: 'fixtures/ok.md',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      preset: 'b1-default',
      learningPresetId: 'general-english',
      learningPresetVersion: 'v1',
      promptSnapshotVersion: 'hw_prompt_v4-2_clean',
      promptAlias: 'current',
      withTts: true,
      upload: 's3',
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: true,
      notionDatabase: 'db-123',
      ttsStrategy: 'dialogue',
      notionUrl: 'https://notion.so/mock',
      createdAt: new Date('2024-01-01T10:00:00Z'),
      updatedAt: new Date('2024-01-01T10:05:00Z'),
      startedAt: new Date('2024-01-01T10:01:00Z'),
      finishedAt: new Date('2024-01-01T10:04:00Z'),
      error: null,
      manifestPath: '/manifests/job-1.json',
    };

    expect(jobRecordToDto(job)).toEqual({
      jobId: 'job-1',
      md: 'fixtures/ok.md',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      preset: 'b1-default',
      learningPresetId: 'general-english',
      learningPresetVersion: 'v1',
      promptSnapshotVersion: 'hw_prompt_v4-2_clean',
      promptAlias: 'current',
      withTts: true,
      upload: 's3',
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: true,
      notionDatabase: 'db-123',
      publishTarget: null,
      ttsStrategy: 'dialogue',
      notionUrl: 'https://notion.so/mock',
      anytypeUrl: null,
      autoPublish: null,
      state: 'succeeded',
      createdAt: '2024-01-01T10:00:00.000Z',
      updatedAt: '2024-01-01T10:05:00.000Z',
      startedAt: '2024-01-01T10:01:00.000Z',
      finishedAt: '2024-01-01T10:04:00.000Z',
      sourceJobId: null,
      error: null,
      providerError: null,
      manifestPath: '/manifests/job-1.json',
    });
  });

  it('normalizes nullable fields to null', () => {
    const job: JobRecord = {
      id: 'job-2',
      state: 'queued',
      md: 'fixtures/ok.md',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      preset: null,
      withTts: null,
      upload: null,
      voiceId: null,
      voiceAccent: null,
      forceTts: null,
      notionDatabase: null,
      ttsStrategy: null,
      notionUrl: null,
      createdAt: new Date('2024-02-02T00:00:00Z'),
      updatedAt: new Date('2024-02-02T00:00:00Z'),
      startedAt: null,
      finishedAt: null,
      error: undefined,
      manifestPath: undefined,
    };

    expect(jobRecordToDto(job)).toEqual({
      jobId: 'job-2',
      md: 'fixtures/ok.md',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      preset: null,
      withTts: null,
      upload: null,
      voiceId: null,
      voiceAccent: null,
      forceTts: null,
      notionDatabase: null,
      publishTarget: null,
      ttsStrategy: null,
      notionUrl: null,
      anytypeUrl: null,
      autoPublish: null,
      state: 'queued',
      createdAt: '2024-02-02T00:00:00.000Z',
      updatedAt: '2024-02-02T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      sourceJobId: null,
      error: null,
      providerError: null,
      manifestPath: null,
    });
  });

  it('parses structured provider errors from tagged job failures', () => {
    const job: JobRecord = {
      id: 'job-3',
      state: 'failed',
      md: 'fixtures/ok.md',
      recordingId: null,
      transcriptId: null,
      promptPackageId: null,
      draftId: null,
      createdAt: new Date('2024-02-03T00:00:00Z'),
      updatedAt: new Date('2024-02-03T00:00:00Z'),
      startedAt: new Date('2024-02-03T00:01:00Z'),
      finishedAt: new Date('2024-02-03T00:02:00Z'),
      error: 'Text-to-Dialogue synthesis failed [provider_rate_limit]: HTTP 429: too many requests',
      manifestPath: null,
    };

    const dto = jobRecordToDto(job);
    expect(dto.providerError).toEqual({
      category: 'provider_rate_limit',
      message: 'Text-to-Dialogue synthesis failed [provider_rate_limit]: HTTP 429: too many requests',
      providerStatus: 429,
      actionableHint: 'Retry later or reduce request concurrency/chunk size.',
    });
  });

  it('parses structured provider errors from untagged inferable failures', () => {
    const job: JobRecord = {
      id: 'job-4',
      state: 'failed',
      md: 'fixtures/ok.md',
      recordingId: null,
      transcriptId: null,
      promptPackageId: null,
      draftId: null,
      createdAt: new Date('2024-02-04T00:00:00Z'),
      updatedAt: new Date('2024-02-04T00:00:00Z'),
      startedAt: new Date('2024-02-04T00:01:00Z'),
      finishedAt: new Date('2024-02-04T00:02:00Z'),
      error: 'Voice generation timed out while calling provider for this lesson',
      manifestPath: null,
    };

    const dto = jobRecordToDto(job);
    expect(dto.providerError).toEqual({
      category: 'provider_timeout',
      message: 'Voice generation timed out while calling provider for this lesson',
      providerStatus: undefined,
      actionableHint: 'Retry with smaller chunks or increased provider timeout settings.',
    });
  });
});

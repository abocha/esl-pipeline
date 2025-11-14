import { describe, it, expect } from 'vitest';
import { jobRecordToDto } from '../src/application/job-dto';
import type { JobRecord } from '../src/domain/job-model';

describe('application/job-dto', () => {
  it('serializes JobRecord fields with ISO timestamps', () => {
    const job: JobRecord = {
      id: 'job-1',
      state: 'succeeded',
      md: 'fixtures/ok.md',
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceAccent: 'american_female',
      forceTts: true,
      notionDatabase: 'db-123',
      mode: 'dialogue',
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
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceAccent: 'american_female',
      forceTts: true,
      notionDatabase: 'db-123',
      mode: 'dialogue',
      notionUrl: 'https://notion.so/mock',
      state: 'succeeded',
      createdAt: '2024-01-01T10:00:00.000Z',
      updatedAt: '2024-01-01T10:05:00.000Z',
      startedAt: '2024-01-01T10:01:00.000Z',
      finishedAt: '2024-01-01T10:04:00.000Z',
      error: null,
      manifestPath: '/manifests/job-1.json',
    });
  });

  it('normalizes nullable fields to null', () => {
    const job: JobRecord = {
      id: 'job-2',
      state: 'queued',
      md: 'fixtures/ok.md',
      preset: null,
      withTts: null,
      upload: null,
      voiceAccent: null,
      forceTts: null,
      notionDatabase: null,
      mode: null,
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
      preset: null,
      withTts: null,
      upload: null,
      voiceAccent: null,
      forceTts: null,
      notionDatabase: null,
      mode: null,
      notionUrl: null,
      state: 'queued',
      createdAt: '2024-02-02T00:00:00.000Z',
      updatedAt: '2024-02-02T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    });
  });
});

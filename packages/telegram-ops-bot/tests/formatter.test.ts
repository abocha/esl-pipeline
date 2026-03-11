import { describe, expect, it } from 'vitest';

import { formatActionStatus, formatJobLinks } from '../src/formatter.js';

describe('formatter', () => {
  it('renders operation status details', () => {
    const html = formatActionStatus({
      operationId: 'op-77',
      action: 'backup_upload',
      state: 'running',
      requestedAt: '2026-03-11T00:00:00Z',
      startedAt: '2026-03-11T00:00:01Z',
      finishedAt: null,
      requestedBy: 'telegram',
      requestedByUserId: 'user-1',
      message: 'Action started',
      command: 'bash backup',
      exitCode: null,
      stdoutTail: null,
      stderrTail: null,
    });

    expect(html).toContain('op-77');
    expect(html).toContain('running');
    expect(html).toContain('Action started');
  });

  it('renders available links and app links', () => {
    const html = formatJobLinks(
      {
        jobId: 'job-1',
        studentId: null,
        md: null,
        recordingId: 'rec-1',
        transcriptId: null,
        promptPackageId: null,
        draftId: null,
        preset: null,
        withTts: null,
        voiceId: null,
        upload: null,
        voiceAccent: null,
        forceTts: null,
        notionDatabase: null,
        publishTarget: null,
        ttsStrategy: null,
        autoPublish: null,
        notionUrl: 'https://notion.so/x',
        anytypeUrl: null,
        htmlUrl: 'https://example.com/html',
        state: 'succeeded',
        createdAt: '2026-03-11T00:00:00Z',
        updatedAt: '2026-03-11T00:00:00Z',
        startedAt: null,
        finishedAt: null,
        error: null,
        manifestPath: null,
      },
      'https://app.example.com',
    );

    expect(html).toContain('Notion');
    expect(html).toContain('HTML');
    expect(html).toContain('App job');
    expect(html).toContain('Recording');
  });
});

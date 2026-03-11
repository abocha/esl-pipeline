import { describe, expect, it } from 'vitest';

import { formatJobLinks } from '../src/formatter.js';

describe('formatter', () => {
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

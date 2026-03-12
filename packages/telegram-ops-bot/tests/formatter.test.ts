import { describe, expect, it } from 'vitest';

import { formatActionStatus, formatAudioPlaybackLink, formatJobLinks } from '../src/formatter.js';

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
        md: [
          '# Lesson',
          '[Audio recording: Study Text](https://bucket.s3.amazonaws.com/audio/final/study.mp3)',
          '[Audio recording: Pronunciation Shadow Sentence](https://bucket.s3.amazonaws.com/audio/pronunciation-shadow/pron.mp3)',
        ].join('\n'),
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
      {
        assignmentTitle: 'Homework Assignment: Office Rules & Modal Verbs',
        assignmentEmoji: '🏢',
      },
    );

    expect(html).toContain('🏢 Homework Assignment: Office Rules &amp; Modal Verbs');
    expect(html).toContain('https://example.com/html');
    expect(html).toContain('🎧 Listen 1: Study Text');
    expect(html).toContain('https://bucket.s3.amazonaws.com/audio/final/study.mp3');
    expect(html).toContain('🗣️ Listen 2: Pronunciation');
    expect(html).toContain('https://bucket.s3.amazonaws.com/audio/pronunciation-shadow/pron.mp3');
  });

  it('renders one-line audio playback link without duplicate labels', () => {
    const html = formatAudioPlaybackLink(
      '🎧 Listen 1: Study Text',
      'https://example.com/audio/final/a.mp3',
    );
    expect(html).toBe(
      '<a href="https://example.com/audio/final/a.mp3">🎧 Listen 1: Study Text</a>',
    );
  });

  it('renders assignment-only card when audio links are disabled', () => {
    const html = formatJobLinks(
      {
        jobId: 'job-2',
        studentId: null,
        md: null,
        recordingId: null,
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
        notionUrl: null,
        anytypeUrl: null,
        htmlUrl: 'https://example.com/assignment.html',
        state: 'succeeded',
        createdAt: '2026-03-11T00:00:00Z',
        updatedAt: '2026-03-11T00:00:00Z',
        startedAt: null,
        finishedAt: null,
        error: null,
        manifestPath: null,
      },
      undefined,
      {
        includeAudioLinks: false,
        assignmentTitle: 'Office Rules & Modal Verbs',
        assignmentEmoji: '🏢',
      },
    );

    expect(html).toBe(
      '<a href="https://example.com/assignment.html">🏢 Homework Assignment: Office Rules &amp; Modal Verbs</a>',
    );
  });
});

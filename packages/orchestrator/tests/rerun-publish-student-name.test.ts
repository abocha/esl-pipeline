import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { RenderAndPublishOptions } from '@esl-pipeline/html-publisher';

import type { PronunciationAudioArtifactClip } from '../src/runtime/audio-artifacts.js';

const { publishedHtml } = vi.hoisted(() => ({
  publishedHtml: [] as string[],
}));

vi.mock('@esl-pipeline/storage-uploader', async () => {
  const actual = await vi.importActual<typeof import('@esl-pipeline/storage-uploader')>(
    '@esl-pipeline/storage-uploader',
  );
  return {
    ...actual,
    uploadFile: vi.fn(async (filePath: string, options: { key?: string }) => {
      const contents = await readFile(filePath, 'utf8').catch(() => '');
      return {
        url: `https://example.com/${options.key ?? 'uploaded-artifact'}`,
        key: options.key ?? 'uploaded-artifact',
        etag: 'etag',
        reused: false,
        sizeBytes: contents.length,
      };
    }),
  };
});

vi.mock('@esl-pipeline/html-publisher', async () => {
  const actual = await vi.importActual<typeof import('@esl-pipeline/html-publisher')>(
    '@esl-pipeline/html-publisher',
  );
  return {
    ...actual,
    renderAndPublishMarkdownToS3: vi.fn(async (options: RenderAndPublishOptions) => {
      const html = await actual.renderToHtml(options.markdown, options.title, options);
      publishedHtml.push(html);
      return {
        url: 'https://example.com/materials/html/rerun.html',
        key: 'materials/html/rerun.html',
        etag: 'html-etag',
        reused: false,
        renderHash: 'html-hash',
        html,
      };
    }),
  };
});

vi.mock('../src/runtime/pronunciation-audio.js', () => ({
  synthesizePronunciationAudio: vi.fn(async () => ({
    mode: 'sentence_shadowing',
    itemClips: [
      {
        id: 'clip-1',
        itemIndex: 0,
        kind: 'shadow_sentence',
        engine: 'provider',
        text: 'Practice this sentence.',
        path: join(tmpdir(), 'rerun-pronunciation.mp3'),
        hash: 'f'.repeat(64),
      } satisfies PronunciationAudioArtifactClip,
    ],
  })),
}));

describe('rerun publish student frontmatter', () => {
  it('renders the real student name into published HTML during an audio rerun', async () => {
    publishedHtml.length = 0;

    const { manifestPathFor, rerunAssignment } = await import('../src/index.js');
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-rerun-student-name-'));
    const mdPath = join(dir, 'lesson.md');
    const audioPath = join(dir, 'study.mp3');
    await writeFile(audioPath, 'audio');
    await writeFile(
      mdPath,
      [
        '---',
        'title: "Homework Assignment"',
        'student: "Alice Nguyen"',
        'topic: "Travel"',
        '---',
        '',
        '# Homework Assignment',
        '',
        '### Pronunciation Micro-Focus',
        '**Shadow sentence:** Practice this sentence.',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      manifestPathFor(mdPath),
      JSON.stringify(
        {
          schemaVersion: 3,
          mdHash: 'original-hash',
          publishTarget: 'html',
          audioArtifacts: {
            studyText: {
              path: audioPath,
              url: 'https://example.com/study.mp3',
              hash: 'a'.repeat(64),
            },
          },
          timestamp: '2026-05-22T00:00:00.000Z',
        },
        null,
        2,
      ),
      'utf8',
    );

    await rerunAssignment({
      md: mdPath,
      manifestMd: mdPath,
      regeneratePronunciationChunkAudio: true,
      upload: 's3',
    });

    expect(publishedHtml).toHaveLength(1);
    expect(publishedHtml[0]).toContain('<span class="tag">Alice Nguyen</span>');
    expect(publishedHtml[0]).not.toContain('<span class="tag">student</span>');
  }, 90000);
});

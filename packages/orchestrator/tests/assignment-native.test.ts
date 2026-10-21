import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync as readAssignmentFixture } from 'node:fs';
import { copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssignmentV1 as FixtureAssignmentV1 } from '@esl-pipeline/contracts';
import {
  type AssignmentPronunciation,
  assignmentMetadata,
  assignmentStudySegments,
  serializeAssignmentV1,
} from '@esl-pipeline/contracts';

import {
  getAssignmentStatus,
  newAssignment,
  planRerunAssignment,
  rerunAssignment,
} from '../src/index.js';
import type { AssignmentManifest, ManifestStore } from '../src/manifest.js';
import { synthesizePronunciationAudio } from '../src/runtime/pronunciation-audio.js';

const audioFiles = vi.hoisted(() => ({ study: '', directory: '' }));

vi.mock('@esl-pipeline/tts-core', async () => {
  const actual =
    await vi.importActual<typeof import('@esl-pipeline/tts-core')>('@esl-pipeline/tts-core');
  return {
    ...actual,
    prepareStudyTextSynthesis: vi.fn(async (input, options) =>
      actual.createPreparedStudyTextSynthesis(input, options),
    ),
    buildStudyTextMp3: vi.fn(async () => ({
      path: audioFiles.study,
      hash: 'study-hash',
      voices: [{ speaker: 'Narrator', voiceId: 'main', source: 'voiceMap' }],
      voiceAssignments: { Narrator: 'main' },
      provider: 'elevenlabs',
      modelId: 'eleven_multilingual_v2',
    })),
    buildPronunciationShadowSentenceMp3: vi.fn(async () => ({
      path: '/unused/sentence.mp3',
      hash: 'sentence-hash',
      voiceId: 'main',
      provider: 'elevenlabs',
      modelId: 'eleven_flash_v2_5',
    })),
    buildPronunciationTextMp3: vi.fn(async (input, options) => {
      await new Promise((resolve) => setTimeout(resolve, input.text === 'first' ? 10 : 1));
      return {
        path: `/unused/${options.fileStem}.mp3`,
        hash: `hash-${input.text}`,
        voiceId: input.voiceId,
        provider: options.ttsProvider,
        modelId: options.ttsModel,
      };
    }),
  };
});
vi.mock('@esl-pipeline/storage-uploader', async () => ({
  ...(await vi.importActual<typeof import('@esl-pipeline/storage-uploader')>(
    '@esl-pipeline/storage-uploader',
  )),
  uploadFile: vi.fn(async (_path, options) => ({
    url: `https://audio.test/${options.key}`,
    key: options.key,
    reused: options.skipIfExists,
  })),
}));
vi.mock('@esl-pipeline/html-publisher', async () => {
  const actual = await vi.importActual<typeof import('@esl-pipeline/html-publisher')>(
    '@esl-pipeline/html-publisher',
  );
  return {
    ...actual,
    renderAndPublishAssignmentToS3: vi.fn(async (options) => ({
      html: await actual.renderAssignmentToHtml(options.assignment, options),
      url: 'https://html.test/lesson',
      key: 'html',
      renderHash: 'html-hash',
    })),
  };
});

const common = {
  target: 'Clear speech',
  focus: 'Practice',
  action: 'Repeat',
  deliverable: 'Record',
};
const modes: AssignmentPronunciation[] = [
  {
    ...common,
    mode: 'shadow_sentence',
    words: [
      { text: 'first', transcription: null },
      { text: 'then', transcription: null },
    ],
    shadowSentence: 'First, then.',
  },
  {
    ...common,
    mode: 'minimal_pair',
    pairs: [
      {
        left: { text: 'ship', transcription: null },
        right: { text: 'sheep', transcription: null },
      },
    ],
  },
  {
    ...common,
    mode: 'connected_speech',
    lines: [{ careful: 'want to', spoken: '/wɒnə/' }],
    naturalSentence: 'I want to try.',
  },
  ...(['intonation', 'rhythm_chunking', 'sentence_stress'] as const).map((mode) => ({
    ...common,
    mode,
    drills: [
      {
        text: 'First, then.',
        transcription: null,
        chunks: ['First,', 'then.'],
        stressedWords: ['First'],
      },
    ],
    naturalSentence: 'First, then.',
    contourCue: null,
  })),
];
const expectedIds = [
  ['shadow-word-1', 'shadow-word-2'],
  ['minimal-pair-1-left', 'minimal-pair-1-right'],
  ['connected-speech-1'],
  ['intonation-1'],
  ['rhythm_chunking-1'],
  ['sentence_stress-1'],
];

describe('native typed execution', () => {
  it('imports the built orchestrator using only its declared production dependencies and package-owned assets', async () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    const manifest = JSON.parse(readAssignmentFixture(join(packageRoot, 'package.json'), 'utf8'));
    const isolated = await mkdtemp(join(tmpdir(), 'esl-orchestrator-runtime-'));
    try {
      await writeFile(join(isolated, 'package.json'), JSON.stringify({ type: 'module' }));
      await copyFile(join(packageRoot, 'dist/index.js'), join(isolated, 'index.js'));
      for (const name of Object.keys(manifest.dependencies)) {
        const link = join(isolated, 'node_modules', name);
        await mkdir(dirname(link), { recursive: true });
        await symlink(await realpath(join(packageRoot, 'node_modules', name)), link, 'junction');
      }
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
        globalThis.fetch = () => { throw new Error('Network read'); };
        const mod = await import('./index.js');
        if (typeof mod.createPipeline !== 'function') throw new Error('Missing createPipeline export');
      `,
        ],
        { cwd: isolated },
      );
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  }, 15_000);
  let persisted: AssignmentManifest | null;
  let store: ManifestStore;
  beforeEach(async () => {
    audioFiles.directory = await mkdtemp(join(tmpdir(), 'esl-native-test-'));
    audioFiles.study = join(audioFiles.directory, 'study.mp3');
    await writeFile(audioFiles.study, 'fixture');
    vi.clearAllMocks();
    persisted = null;
    store = {
      manifestPathFor: (md) => `${md}.manifest.json`,
      readManifest: async () => persisted,
      writeManifest: vi.fn(async (md, manifest) => {
        persisted = manifest;
        return `${md}.manifest.json`;
      }),
    };
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(audioFiles.directory, { recursive: true, force: true });
  });

  it('rejects missing typed input before reading manifests or performing execution', async () => {
    const readManifest = vi.spyOn(store, 'readManifest');
    await expect(
      newAssignment({ md: '/historical/lesson.md' } as never, {}, { manifestStore: store }),
    ).rejects.toThrow('read-only');
    await expect(
      rerunAssignment({ md: '/historical/lesson.md' } as never, { manifestStore: store }),
    ).rejects.toThrow('read-only');
    expect(readManifest).not.toHaveBeenCalled();
    expect(store.writeManifest).not.toHaveBeenCalled();
    const core = await import('@esl-pipeline/tts-core');
    const html = await import('@esl-pipeline/html-publisher');
    expect(core.buildStudyTextMp3).not.toHaveBeenCalled();
    expect(html.renderAndPublishAssignmentToS3).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 4, 5])(
    'keeps schema-%i historical evidence readable while rejecting every rerun target and conversion',
    async (schemaVersion) => {
      const md = `${audioFiles.directory}/historical.md`;
      const originalBytes = '# Original historical evidence\n';
      await writeFile(md, originalBytes);
      persisted = {
        schemaVersion,
        mdHash: createHash('sha256').update(originalBytes).digest('hex'),
        htmlUrl: 'https://historical.test/output',
        audioArtifacts: {
          studyText: { path: audioFiles.study, url: 'https://historical.test/audio' },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      };
      const originalManifest = structuredClone(persisted);
      const status = await getAssignmentStatus(md, { manifestStore: store });
      expect(status).toMatchObject({
        manifest: originalManifest,
        mdHashMatches: true,
        audioFileExists: true,
      });
      for (const target of [
        { republishOnly: true },
        { regenerateStudyTextAudio: true },
        { regeneratePronunciationMainAudio: true },
        { regeneratePronunciationChunkAudio: true },
      ]) {
        await expect(
          rerunAssignment(
            { md, assignment: assignmentFixture(), ...target },
            { manifestStore: store },
          ),
        ).rejects.toThrow('read-only');
        const plan = await planRerunAssignment({ md, ...target }, { manifestStore: store });
        expect(plan.executable).toEqual([]);
        expect(plan.errors.join(' ')).toContain('read-only');
      }
      await expect(
        newAssignment({ md, assignment: assignmentFixture() }, {}, { manifestStore: store }),
      ).rejects.toThrow('read-only');
      expect(persisted).toEqual(originalManifest);
      expect(readAssignmentFixture(md, 'utf8')).toBe(originalBytes);
      expect(store.writeManifest).not.toHaveBeenCalled();
      const core = await import('@esl-pipeline/tts-core');
      const html = await import('@esl-pipeline/html-publisher');
      expect(core.buildStudyTextMp3).not.toHaveBeenCalled();
      expect(html.renderAndPublishAssignmentToS3).not.toHaveBeenCalled();
    },
  );

  it('publishes directly with validated canonical identity, typed speech context and no source file', async () => {
    const assignment = assignmentFixture();
    assignment.metadata.icon = '🌦️';
    assignment.pronunciation = null;
    const result = await newAssignment(
      {
        md: '/nonexistent/typed.json',
        assignment,
        withTts: true,
        voiceId: 'main',
        ttsProvider: 'elevenlabs',
      },
      {},
      { manifestStore: store },
    );
    expect(result.htmlUrl).toBe('https://html.test/lesson');
    const hash = createHash('sha256').update(serializeAssignmentV1(assignment)).digest('hex');
    expect(persisted).toMatchObject({
      schemaVersion: 6,
      assignmentHash: hash,
      mdHash: hash,
      publication: {
        schemaVersion: 1,
        rendererVersion: 3,
        title: assignment.metadata.title,
        icon: '🌦️',
      },
    });
    const core = await import('@esl-pipeline/tts-core');
    expect(core.prepareStudyTextSynthesis).toHaveBeenCalledWith(
      expect.objectContaining({ assignment }),
      expect.anything(),
    );
    expect(persisted?.speechPlans?.studyText?.segments).toEqual(
      assignmentStudySegments(assignment),
    );
    const prepared = core.createPreparedStudyTextSynthesis(
      { assignment },
      { outPath: '', voiceMapPath: '', ttsProvider: 'inworld', ttsModel: 'inworld-tts-2' },
    );
    expect(prepared.enhancementContext).toEqual({ assignment });
    expect(assignmentMetadata(assignment).speaker_labels).toEqual(['Alex', 'Jo']);
  });

  it('fails domain and supplied-URL admission before publishing or writing a manifest', async () => {
    const assignment = assignmentFixture();
    assignment.input.source.url = 'https://invented.test/source';
    await expect(
      newAssignment({ md: '/nonexistent/input', assignment }, {}, { manifestStore: store }),
    ).rejects.toThrow('supplied');
    expect(store.writeManifest).not.toHaveBeenCalled();
    const html = await import('@esl-pipeline/html-publisher');
    expect(html.renderAndPublishAssignmentToS3).not.toHaveBeenCalled();
  });

  it.each(modes.map((p, i) => ({ p, ids: expectedIds[i]! })))(
    'synthesizes $p.mode in deterministic item order and reuses unchanged identities',
    async ({ p, ids }) => {
      const assignment = assignmentFixture();
      assignment.pronunciation = p;
      const options = {
        assignment,
        mdPath: '/virtual/lesson.json',
        outPath: '/unused',
        primaryTtsProvider: 'elevenlabs' as const,
        primaryTtsModel: 'eleven_flash_v2_5' as const,
        primaryVoiceId: 'main',
        chunkTtsProvider: 'elevenlabs' as const,
        chunkTtsModel: 'eleven_flash_v2_5' as const,
        chunkVoiceId: 'chunk',
      };
      const first = await synthesizePronunciationAudio(options);
      expect(first?.itemClips?.map((c) => c.id)).toEqual(ids);
      expect(first?.itemClips?.[0]?.text).toBe(
        p.mode === 'connected_speech'
          ? 'want to'
          : p.mode === 'minimal_pair'
            ? 'ship'
            : p.mode === 'shadow_sentence'
              ? 'first'
              : 'First, then.',
      );
      const core = await import('@esl-pipeline/tts-core');
      vi.mocked(core.buildPronunciationTextMp3).mockClear();
      vi.mocked(core.buildPronunciationShadowSentenceMp3).mockClear();
      const next = await synthesizePronunciationAudio({ ...options, previousAudio: first });
      expect(next?.itemClips?.map((c) => c.hash)).toEqual(first?.itemClips?.map((c) => c.hash));
      expect(core.buildPronunciationTextMp3).not.toHaveBeenCalled();
      expect(core.buildPronunciationShadowSentenceMp3).not.toHaveBeenCalled();
    },
  );

  it('keeps unchecked audio history while suppressing absent pronunciation in publication metadata', async () => {
    const assignment = assignmentFixture();
    assignment.metadata.icon = '🧭';
    await newAssignment(
      {
        md: '/virtual/optional',
        assignment,
        withTts: true,
        ttsProvider: 'elevenlabs',
        upload: 's3',
      },
      {},
      { manifestStore: store },
    );
    const previous = structuredClone(persisted!.audioArtifacts!.pronunciation);
    assignment.pronunciation = null;
    await rerunAssignment(
      { md: '/virtual/optional', assignment, republishOnly: true },
      { manifestStore: store },
    );
    expect(persisted?.audioArtifacts?.pronunciation).toEqual(previous);
    expect(persisted?.publication?.pronunciationAudioUrl).toBeNull();
    expect(persisted?.publication?.rendererVersion).toBe(3);
    expect(persisted?.publication?.icon).toBe('🧭');
  });

  it('regenerates and replaces selected changed clips while preserving unchecked families and defaults', async () => {
    const assignment = assignmentFixture();
    assignment.pronunciation = modes[0]!;
    vi.stubEnv('S3_BUCKET', 'test');
    await newAssignment(
      {
        md: '/virtual/lesson',
        assignment,
        withTts: true,
        voiceId: 'main',
        ttsProvider: 'elevenlabs',
        upload: 's3',
      },
      {},
      { manifestStore: store },
    );
    const study = structuredClone(persisted!.audioArtifacts!.studyText);
    const primary = structuredClone(persisted!.audioArtifacts!.pronunciation!.primaryClip);
    const core = await import('@esl-pipeline/tts-core');
    vi.mocked(core.buildStudyTextMp3).mockClear();
    vi.mocked(core.buildPronunciationShadowSentenceMp3).mockClear();
    const uploader = await import('@esl-pipeline/storage-uploader');
    vi.mocked(uploader.uploadFile).mockClear();
    assignment.pronunciation = {
      ...(modes[0] as Extract<AssignmentPronunciation, { mode: 'shadow_sentence' }>),
      words: [
        { text: 'changed', transcription: null },
        { text: 'then', transcription: null },
      ],
    };
    await rerunAssignment(
      {
        md: '/virtual/lesson',
        assignment,
        regeneratePronunciationChunkAudio: true,
        pronunciationChunkVoiceId: 'chunk',
        pronunciationChunkTtsProvider: 'elevenlabs',
        pronunciationChunkTtsModel: 'eleven_flash_v2_5',
        upload: 's3',
      },
      { manifestStore: store },
    );
    expect(persisted?.audioArtifacts?.studyText).toEqual(study);
    expect(persisted?.audioArtifacts?.pronunciation?.primaryClip).toEqual(primary);
    expect(core.buildStudyTextMp3).not.toHaveBeenCalled();
    expect(core.buildPronunciationShadowSentenceMp3).not.toHaveBeenCalled();
    expect(uploader.uploadFile).toHaveBeenCalledWith(
      expect.stringContaining('shadow-word-1'),
      expect.objectContaining({ skipIfExists: false }),
    );
    const calls = vi.mocked(uploader.uploadFile).mock.calls;
    expect(calls.some(([path]) => String(path).includes('study'))).toBe(false);
    expect(persisted?.ttsStrategy).toBeUndefined();
  });

  it('uses resolved Gemini defaults for the full sentence while keeping fresh chunks on Chirp', async () => {
    vi.stubEnv('ESL_TTS_DEFAULT_PROVIDER', 'gemini');
    vi.stubEnv('ESL_TTS_PROVIDER_GEMINI_MODEL', 'gemini-3.8-flash-tts');
    const assignment = assignmentFixture();
    assignment.pronunciation = modes[0]!;
    const core = await import('@esl-pipeline/tts-core');
    vi.mocked(core.buildStudyTextMp3).mockResolvedValueOnce({
      path: audioFiles.study,
      hash: 'gemini-study',
      provider: 'gemini',
      modelId: 'gemini-3.8-flash-tts',
      voices: [{ speaker: 'Alex', voiceId: 'Kore', source: 'auto' }],
      voiceAssignments: { Alex: 'Kore' },
    });
    await newAssignment(
      { md: '/virtual/default-gemini', assignment, withTts: true },
      {},
      { manifestStore: store },
    );
    expect(core.buildPronunciationShadowSentenceMp3).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: 'Kore' }),
      expect.objectContaining({ ttsProvider: 'gemini', ttsModel: 'gemini-3.8-flash-tts' }),
    );
    for (const call of vi.mocked(core.buildPronunciationTextMp3).mock.calls) {
      expect(call[1]).toMatchObject({ ttsProvider: 'google', ttsModel: 'chirp3_hd' });
      expect(call[0].voiceId).toBe('en-US-Chirp3-HD-Charon');
    }
    expect(core.buildPronunciationTextMp3).toHaveBeenCalledTimes(2);
  });

  it.each(['main', 'items'] as const)(
    'switches only the selected pronunciation %s family to Gemini with compatible defaults',
    async (family) => {
      const assignment = assignmentFixture();
      assignment.pronunciation = modes[0]!;
      await newAssignment(
        {
          md: '/virtual/provider-switch',
          assignment,
          withTts: true,
          voiceId: 'main',
          ttsProvider: 'elevenlabs',
          upload: 's3',
        },
        {},
        { manifestStore: store },
      );
      const study = structuredClone(persisted!.audioArtifacts!.studyText);
      const previous = structuredClone(persisted!.audioArtifacts!.pronunciation);
      const core = await import('@esl-pipeline/tts-core');
      const actual = await vi.importActual<typeof core>('@esl-pipeline/tts-core');
      vi.mocked(core.buildStudyTextMp3).mockClear();
      vi.mocked(core.buildPronunciationShadowSentenceMp3).mockImplementation(
        async (input, options) => {
          const selection = actual.validateTtsSelection({
            provider: options.ttsProvider!,
            model: options.ttsModel,
          });
          return {
            path: '/unused/gemini-shadow.mp3',
            hash: 'gemini-shadow',
            voiceId: input.voiceId,
            provider: selection.provider,
            modelId: selection.model,
          };
        },
      );
      vi.mocked(core.buildPronunciationTextMp3).mockImplementation(async (input, options) => {
        const selection = actual.validateTtsSelection({
          provider: options.ttsProvider!,
          model: options.ttsModel,
        });
        return {
          path: `/unused/${options.fileStem}.mp3`,
          hash: `gemini-${input.text}`,
          voiceId: input.voiceId,
          provider: selection.provider,
          modelId: selection.model,
        };
      });
      await rerunAssignment(
        {
          md: '/virtual/provider-switch',
          assignment,
          regeneratePronunciationMainAudio: family === 'main',
          regeneratePronunciationChunkAudio: family === 'items',
          ...(family === 'main'
            ? { pronunciationMainTtsProvider: 'gemini' as const }
            : { pronunciationChunkTtsProvider: 'gemini' as const }),
          upload: 's3',
        },
        { manifestStore: store },
      );
      expect(core.buildStudyTextMp3).not.toHaveBeenCalled();
      expect(persisted?.audioArtifacts?.studyText).toEqual(study);
      const next = persisted?.audioArtifacts?.pronunciation;
      const changed = family === 'main' ? [next?.primaryClip] : next?.itemClips;
      expect(changed?.length).toBeGreaterThan(0);
      for (const clip of changed ?? []) {
        expect(clip).toMatchObject({
          voiceId: 'Kore',
          tts: { provider: 'gemini', modelId: 'gemini-3.8-flash-lite-tts' },
        });
      }
      expect(family === 'main' ? next?.itemClips : next?.primaryClip).toEqual(
        family === 'main' ? previous?.itemClips : previous?.primaryClip,
      );
    },
  );
});

function assignmentFixture(): FixtureAssignmentV1 {
  return JSON.parse(
    readAssignmentFixture(
      new URL('../../contracts/tests/assignment-fixture.json', import.meta.url),
      'utf8',
    ),
  ) as FixtureAssignmentV1;
}

import { describe, expect, it } from 'vitest';

import {
  type BuildStudyTextOptions,
  createTtsEngine,
  type TtsProviderAdapter,
  type TtsProviderId,
} from '../src/index.js';
import { createTtsAssignment } from './assignment-fixture.js';

function createProvider(
  id: TtsProviderId,
  hooks: {
    onStudyTextOptions?: (options: BuildStudyTextOptions) => void;
    resolveSpeakerAssignments?: TtsProviderAdapter['voice']['resolveSpeakerAssignments'];
  } = {},
): TtsProviderAdapter {
  return {
    id,
    providerMetadata() {
      return { provider: id, pricingToken: id.toUpperCase() };
    },
    voice: {
      async loadCatalog() {
        return { voices: [] };
      },
      async resolveSpeakerAssignments(args) {
        return hooks.resolveSpeakerAssignments?.(args) ?? [];
      },
    },
    async synthesizeStudyText(_input, options) {
      hooks.onStudyTextOptions?.(options);
      return {
        path: `/tmp/${id}.mp3`,
        hash: id,
        voices: [],
        provider: id,
      };
    },
    async synthesizeShadowSentence() {
      return {
        path: `/tmp/${id}-shadow.mp3`,
        hash: `${id}-shadow`,
        voiceId: id,
        provider: id,
      };
    },
    async synthesizePronunciationText() {
      return {
        path: `/tmp/${id}-pronunciation.mp3`,
        hash: `${id}-pronunciation`,
        voiceId: id,
        provider: id,
      };
    },
  };
}

describe('DefaultTtsEngine provider selection', () => {
  it('prefers elevenlabs by default when registered', async () => {
    delete process.env.ESL_TTS_DEFAULT_PROVIDER;
    delete process.env.ESL_TTS_PROVIDER_ORDER;

    const engine = createTtsEngine([createProvider('elevenlabs'), createProvider('google')]);
    const result = await engine.buildStudyTextMp3(
      { assignment: {} as never },
      { voiceMapPath: 'voices.yml', outPath: '/tmp' },
    );

    expect(result.provider).toBe('elevenlabs');
  });

  it('falls back to registered provider order when default is unavailable', async () => {
    process.env.ESL_TTS_DEFAULT_PROVIDER = 'google';
    process.env.ESL_TTS_PROVIDER_ORDER = 'google,elevenlabs';

    const engine = createTtsEngine([createProvider('elevenlabs')]);
    const result = await engine.buildStudyTextMp3(
      { assignment: {} as never },
      { voiceMapPath: 'voices.yml', outPath: '/tmp' },
    );

    expect(result.provider).toBe('elevenlabs');
  });

  it('uses explicit provider override over env defaults', async () => {
    process.env.ESL_TTS_DEFAULT_PROVIDER = 'elevenlabs';
    process.env.ESL_TTS_PROVIDER_ORDER = 'elevenlabs,google';

    const engine = createTtsEngine([createProvider('elevenlabs'), createProvider('google')]);
    const result = await engine.buildStudyTextMp3(
      { assignment: {} as never },
      { voiceMapPath: 'voices.yml', outPath: '/tmp', ttsProvider: 'google' },
    );

    expect(result.provider).toBe('google');
  });

  it('selects inworld from defaults and provider order', async () => {
    process.env.ESL_TTS_DEFAULT_PROVIDER = 'inworld';
    process.env.ESL_TTS_PROVIDER_ORDER = 'google,inworld,elevenlabs';

    const engine = createTtsEngine([
      createProvider('elevenlabs'),
      createProvider('google'),
      createProvider('inworld'),
    ]);
    const result = await engine.buildStudyTextMp3(
      { assignment: {} as never },
      { voiceMapPath: 'voices.yml', outPath: '/tmp' },
    );

    expect(result.provider).toBe('inworld');
  });

  it('preserves omitted model options so providers can apply mode-specific defaults', async () => {
    delete process.env.ESL_TTS_DEFAULT_PROVIDER;
    delete process.env.ESL_TTS_PROVIDER_ORDER;
    const seenModels: BuildStudyTextOptions['ttsModel'][] = [];
    const engine = createTtsEngine([
      createProvider('elevenlabs', {
        onStudyTextOptions(options) {
          seenModels.push(options.ttsModel);
        },
      }),
    ]);

    await engine.buildStudyTextMp3(
      { assignment: {} as never },
      { voiceMapPath: 'voices.yml', outPath: '/tmp' },
    );

    expect(seenModels).toEqual([undefined]);
  });

  it('still rejects explicit models that do not belong to the selected provider', async () => {
    const engine = createTtsEngine([createProvider('google')]);

    await expect(
      engine.buildStudyTextMp3(
        { assignment: {} as never },
        {
          voiceMapPath: 'voices.yml',
          outPath: '/tmp',
          ttsProvider: 'google',
          ttsModel: 'eleven_v3',
        },
      ),
    ).rejects.toThrow('TTS model "eleven_v3" is not supported by provider "google".');
  });

  it('prepares study text with provider-resolved voice-plan assignments', async () => {
    const engine = createTtsEngine([
      createProvider('inworld', {
        async resolveSpeakerAssignments() {
          return [
            {
              speaker: '[Maya]',
              voiceId: 'Ashley',
              source: 'auto',
              capabilities: {
                supportsMetadataInstructions: true,
                supportsNonVerbals: true,
                supportsUppercaseEmphasis: true,
                supportsFreeFormDirection: true,
              },
            },
            {
              speaker: 'Maya',
              voiceId: 'Duplicate Ashley',
              source: 'default',
            },
          ];
        },
      }),
    ]);
    const context = createTtsAssignment({
      metadata: { title: 'Test', student: 'Alex', level: 'B1', topic: 'work' },
      studyText: {
        type: 'dialogue',
        speakers: [
          {
            id: 's0',
            displayName: 'Maya',
            role: 'student',
            persona: null,
            voiceDirection: null,
            gender: 'neutral',
            age: null,
            accent: null,
          },
        ],
        turns: [{ speakerId: 's0', text: 'We need a clearer deadline.' }],
      },
      pronunciation: null,
    });

    const prepared = await engine.prepareStudyTextSynthesis(
      { assignment: context },
      {
        voiceMapPath: 'voices.yml',
        outPath: '/tmp',
        ttsProvider: 'inworld',
        ttsModel: 'inworld-tts-2',
      },
    );

    expect(prepared.voicePlan?.assignments).toMatchObject([
      {
        speaker: 'Maya',
        voiceId: 'Ashley',
        capabilities: { supportsFreeFormDirection: true },
      },
    ]);
    expect(prepared.voiceAssignments).toEqual({ Maya: 'Ashley' });
  });

  it('preserves rich ranked assignment resolution provenance', async () => {
    const ranker = {
      metadata: {
        provider: 'google_ai_studio',
        model: 'gemma-4-26b-a4b-it',
        generatedAt: '2026-06-02T00:00:00.000Z',
      },
      async rank() {
        return { selections: [] };
      },
    };
    const engine = createTtsEngine([
      createProvider('inworld', {
        async resolveSpeakerAssignments() {
          return {
            mode: 'ranked',
            assignments: [{ speaker: 'Maya', voiceId: 'Ashley', source: 'auto' }],
          };
        },
      }),
    ]);
    const context = createTtsAssignment({
      metadata: { title: 'Test', student: 'Alex', level: 'B1', topic: 'work' },
      studyText: {
        type: 'dialogue',
        speakers: [
          {
            id: 's0',
            displayName: 'Maya',
            role: 'student',
            persona: null,
            voiceDirection: null,
            gender: 'neutral',
            age: null,
            accent: null,
          },
        ],
        turns: [{ speakerId: 's0', text: 'Hello.' }],
      },
      pronunciation: null,
    });

    const prepared = await engine.prepareStudyTextSynthesis(
      { assignment: context },
      {
        voiceMapPath: 'voices.yml',
        outPath: '/tmp',
        ttsProvider: 'inworld',
        ttsModel: 'inworld-tts-2',
        voiceRanker: ranker,
      },
    );

    expect(prepared.voicePlan).toMatchObject({
      mode: 'ranked',
      ranker: ranker.metadata,
      assignments: [{ speaker: 'Maya', voiceId: 'Ashley' }],
    });
  });

  it('omits ranker provenance when rich resolution reports deterministic fallback', async () => {
    const engine = createTtsEngine([
      createProvider('inworld', {
        async resolveSpeakerAssignments() {
          return {
            mode: 'deterministic',
            fallbackReason: 'model_not_supported',
            assignments: [{ speaker: 'Maya', voiceId: 'Ashley', source: 'fallback' }],
          };
        },
      }),
    ]);
    const context = createTtsAssignment({
      metadata: { title: 'Test', student: 'Alex', level: 'B1', topic: 'work' },
      studyText: {
        type: 'dialogue',
        speakers: [
          {
            id: 's0',
            displayName: 'Maya',
            role: 'student',
            persona: null,
            voiceDirection: null,
            gender: 'neutral',
            age: null,
            accent: null,
          },
        ],
        turns: [{ speakerId: 's0', text: 'Hello.' }],
      },
      pronunciation: null,
    });

    const prepared = await engine.prepareStudyTextSynthesis(
      { assignment: context },
      {
        voiceMapPath: 'voices.yml',
        outPath: '/tmp',
        ttsProvider: 'inworld',
        ttsModel: 'inworld-tts-2',
      },
    );

    expect(prepared.voicePlan).toMatchObject({
      mode: 'deterministic',
      fallbackReason: 'model_not_supported',
    });
    expect(prepared.voicePlan).not.toHaveProperty('ranker');
  });
});

it('rejects historical Markdown before invoking a TTS provider', async () => {
  let calls = 0;
  const provider = createProvider('elevenlabs', {
    onStudyTextOptions: () => {
      calls += 1;
    },
  });
  provider.synthesizeShadowSentence = async () => {
    calls += 1;
    return { path: 'unused', hash: 'unused', voiceId: 'unused' };
  };
  provider.voice.resolveSpeakerAssignments = async () => {
    calls += 1;
    return [];
  };
  const engine = createTtsEngine([provider]);
  const historical = { context: { rawMarkdown: '# History' } } as never;
  const options = { voiceMapPath: 'unused', outPath: 'unused' };
  await expect(engine.buildStudyTextMp3(historical, options)).rejects.toThrow(
    'Historical Markdown assignments are read-only',
  );
  await expect(engine.prepareStudyTextSynthesis(historical, options)).rejects.toThrow(
    'Historical Markdown assignments are read-only',
  );
  await expect(engine.buildPronunciationShadowSentenceMp3(historical, options)).rejects.toThrow(
    'Historical Markdown assignments are read-only',
  );
  expect(calls).toBe(0);
});

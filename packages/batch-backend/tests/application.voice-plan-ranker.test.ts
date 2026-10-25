import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VoicePlanRankRequest } from '@esl-pipeline/tts-core';
import { resolveInworldSpeakerAssignmentsWithRankerFromCatalog } from '@esl-pipeline/tts-provider-inworld';

import { createBackendVoicePlanRanker } from '../src/application/voice-plan-ranker.js';
import { loadConfig } from '../src/config/env.js';

afterEach(() => vi.unstubAllGlobals());

const shortlistRequest: VoicePlanRankRequest = {
  provider: 'inworld',
  model: 'inworld-tts-2',
  speakers: ['Maya', 'Leo'].map((speaker) => ({
    speaker,
    profile: { id: speaker, role: speaker === 'Maya' ? 'calm manager' : 'friendly colleague' },
    candidates: ['Warm Plain', 'Cool Steerable'].map((voiceId) => ({
      voiceId,
      name: voiceId,
      score: 88,
      capabilities: {
        supportsMetadataInstructions: true,
        supportsNonVerbals: true,
        supportsUppercaseEmphasis: true,
        supportsFreeFormDirection: true,
      },
    })),
  })),
};

describe('application/voice-plan-ranker', () => {
  it('uses structured OpenAI output with the dedicated Luna model', async () => {
    const base = loadConfig();
    const config = {
      ...base,
      generation: {
        ...base.generation,
        providers: {
          ...base.generation.providers,
          openai: {
            ...base.generation.providers.openai,
            apiKey: 'test-openai-key',
          },
        },
      },
    };
    const executor = vi.fn().mockResolvedValue({
      output: {
        selections: [{ speaker: 'Nina', voiceId: 'calm-american' }],
      },
      rawText: '{}',
      usage: { totalTokens: 12 },
    });
    const ranker = createBackendVoicePlanRanker(config, {
      executor,
      now: () => new Date('2026-06-02T00:00:00.000Z'),
    });

    await expect(
      ranker.rank({
        provider: 'inworld',
        model: 'inworld-tts-2',
        speakers: [
          {
            speaker: 'Nina',
            profile: { id: 'Nina', role: 'thoughtful project manager' },
            candidates: [
              {
                voiceId: 'calm-american',
                name: 'Calm American',
                score: 88,
                tags: ['neutral', 'steerable'],
                capabilities: {
                  supportsMetadataInstructions: true,
                  supportsNonVerbals: true,
                  supportsUppercaseEmphasis: true,
                  supportsFreeFormDirection: true,
                },
              },
            ],
          },
        ],
      }),
    ).resolves.toEqual({
      selections: [{ speaker: 'Nina', voiceId: 'calm-american' }],
    });
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          model: 'gpt-5.6-luna',
          maxOutputTokens: 1200,
          prompt: expect.stringContaining('Do not emit Markdown fences, prose, reasons'),
          responseSchema: expect.objectContaining({
            schema: expect.objectContaining({
              properties: expect.objectContaining({
                selections: expect.objectContaining({
                  items: expect.objectContaining({
                    properties: expect.not.objectContaining({
                      reason: expect.anything(),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('makes one non-stored Responses call for overlapping speaker shortlists and accounts for returned tokens', async () => {
    const config = loadConfig();
    config.generation.providers.openai.apiKey = 'synthetic-test-key';
    const selections = [
      { speaker: 'Leo', voiceId: 'Cool Steerable' },
      { speaker: 'Maya', voiceId: 'Warm Plain' },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'rank-1',
          model: 'gpt-5.6-luna',
          status: 'completed',
          output_text: JSON.stringify({ selections }),
          usage: {
            input_tokens: 100,
            output_tokens: 30,
            total_tokens: 130,
            output_tokens_details: { reasoning_tokens: 10 },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const reserve = vi.fn().mockResolvedValue({ allowed: true, usage: {} });
    const recordActual = vi.fn();
    const ranker = createBackendVoicePlanRanker(config, {
      budget: { repository: { reserve, recordActual, getUsage: vi.fn() } },
    });
    await expect(ranker.rank(shortlistRequest)).resolves.toEqual({ selections });
    expect(ranker.metadata).toMatchObject({ provider: 'openai', model: 'gpt-5.6-luna' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      model: 'gpt-5.6-luna',
      store: false,
      max_output_tokens: 1200,
      reasoning: { effort: 'low' },
      text: {
        verbosity: 'low',
        format: { type: 'json_schema', name: 'tts_voice_plan_ranking', strict: true },
      },
    });
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.6-luna',
        limits: expect.objectContaining({ tpmBudget: 160_000, dailyTokenBudget: 2_250_000 }),
      }),
    );
    expect(recordActual).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', model: 'gpt-5.6-luna', actualTokens: 130 }),
    );
  });

  it('records billed usage when the provider returns malformed structured JSON', async () => {
    const config = loadConfig();
    config.generation.providers.openai.apiKey = 'synthetic-test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'rank-malformed',
            model: 'gpt-5.6-luna',
            status: 'completed',
            output_text: 'not JSON',
            usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
          }),
          { status: 200 },
        ),
      ),
    );
    const recordActual = vi.fn();
    const ranker = createBackendVoicePlanRanker(config, {
      budget: {
        repository: {
          reserve: vi.fn().mockResolvedValue({ allowed: true, usage: {} }),
          recordActual,
          getUsage: vi.fn(),
        },
      },
    });
    await expect(ranker.rank(shortlistRequest)).rejects.toMatchObject({
      code: 'malformed_structured_output',
      providerRequestId: 'rank-malformed',
    });
    expect(recordActual).toHaveBeenCalledOnce();
    expect(recordActual).toHaveBeenCalledWith(expect.objectContaining({ actualTokens: 130 }));
  });

  it.each([
    { selections: [{ speaker: 'Maya', voiceId: 'Warm Plain' }] },
    {
      selections: [
        { speaker: 'Maya', voiceId: 'Warm Plain' },
        { speaker: 'Maya', voiceId: 'Cool Steerable' },
      ],
    },
    {
      selections: [
        { speaker: 'Maya', voiceId: 'unknown' },
        { speaker: 'Leo', voiceId: 'Cool Steerable' },
      ],
    },
  ])(
    'rejects missing, duplicate or out-of-shortlist selections for deterministic recovery',
    async (output) => {
      const ranker = createBackendVoicePlanRanker(loadConfig(), {
        executor: vi.fn().mockResolvedValue({ output, rawText: JSON.stringify(output) }),
      });
      await expect(ranker.rank(shortlistRequest)).rejects.toThrow('Voice ranker output');
    },
  );

  it('rejects incomplete output and does not retry or change provider', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: { selections: [] },
      rawText: '{}',
      finishReason: 'incomplete:max_output_tokens',
    });
    await expect(
      createBackendVoicePlanRanker(loadConfig(), { executor }).rank(shortlistRequest),
    ).rejects.toThrow('did not complete');
    expect(executor).toHaveBeenCalledOnce();
  });

  it.each(['unique', 'collision', 'failure', 'explicit', 'exhausted'] as const)(
    'preserves catalog selection for the representative %s case',
    async (scenario) => {
      const voices = (scenario === 'exhausted' ? ['A'] : ['A', 'B', 'C']).map((id) => ({
        id,
        name: id,
        labels: { language: 'en_us', accent: 'american', tags: ['neutral', 'steerable'] },
      }));
      const executor =
        scenario === 'failure'
          ? vi.fn().mockRejectedValue(new Error('provider unavailable'))
          : vi.fn().mockResolvedValue({
              output: {
                selections:
                  scenario === 'explicit'
                    ? [{ speaker: 'Leo', voiceId: 'B' }]
                    : [
                        { speaker: 'Maya', voiceId: scenario === 'unique' ? 'C' : 'A' },
                        { speaker: 'Leo', voiceId: 'A' },
                      ],
              },
              rawText: '{}',
            });
      const ranker = createBackendVoicePlanRanker(loadConfig(), { executor });
      const result = await resolveInworldSpeakerAssignmentsWithRankerFromCatalog(
        ['Maya', 'Leo'],
        scenario === 'explicit' ? { Maya: 'A' } : {},
        { voices },
        { model: 'inworld-tts-2', defaultAccent: 'american', ranker },
      );
      expect(result.assignments.map((a) => a.voiceId)).toEqual(
        scenario === 'unique' ? ['C', 'A'] : scenario === 'exhausted' ? ['A', 'A'] : ['A', 'B'],
      );
      expect(result.mode).toBe(
        scenario === 'collision' || scenario === 'failure' ? 'fallback' : 'ranked',
      );
      expect(result.assignments[0]?.source).toBe(scenario === 'explicit' ? 'voiceMap' : 'auto');
      expect(executor).toHaveBeenCalledOnce();
    },
  );
});

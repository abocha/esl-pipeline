import { describe, expect, test } from 'vitest';

import { getProviderAdapter, providerIds } from '../providers';
import type { ProviderInput } from '../providers/types';

const context = (
  providerId: ProviderInput['providerId'],
  runMode: ProviderInput['runMode'] = 'mixed_diarized',
) => ({
  providerId,
  runMode,
  inputPath: 'C:\\bench\\prepared\\lesson.wav',
  fileName: 'lesson.wav',
  sourceChannels: runMode === 'trusted_split_control' ? 2 : 2,
  preparedChannels: 1,
  sourceDurationMs: 60_000,
  preparedDurationMs: 60_000,
  options: {},
  runId: 'run-1',
  selectedInputSha256: 'a'.repeat(64),
});

describe('provider-local benchmark adapters', () => {
  test('exposes exactly the approved first-slice providers', () => {
    expect(providerIds).toEqual([
      'soniox-v5-async',
      'speechmatics-melia-1-batch',
      'mistral-voxtral-mini-transcribe-2',
      'deepgram-nova-3',
      'elevenlabs-scribe-v2',
    ]);
  });

  test.each(providerIds)('%s builds a redacted request intent', (providerId) => {
    const intent = getProviderAdapter(providerId).buildIntent(context(providerId));

    expect(intent.providerId).toBe(providerId);
    expect(intent.steps.length).toBeGreaterThan(0);
    expect(JSON.stringify(intent)).not.toMatch(/test-secret|api[_-]?key\s*[:=]/iu);
    expect(
      intent.steps.some(
        (step) =>
          step.body &&
          'filePath' in step.body &&
          step.body.filePath === 'C:\\bench\\prepared\\lesson.wav',
      ),
    ).toBe(true);
  });

  test('keeps Deepgram split control separate from mixed diarization', () => {
    const adapter = getProviderAdapter('deepgram-nova-3');
    const mixed = adapter.buildIntent(context('deepgram-nova-3', 'mixed_diarized'));
    const split = adapter.buildIntent(context('deepgram-nova-3', 'trusted_split_control'));

    expect(mixed.runMode).toBe('mixed_diarized');
    expect(split.runMode).toBe('trusted_split_control');
    expect(mixed.steps[0]?.url).toContain('diarize_model=latest');
    expect(split.steps[0]?.url).toContain('multichannel=true');
  });

  test('requests one Mistral timestamp granularity for direct transcription', () => {
    const intent = getProviderAdapter('mistral-voxtral-mini-transcribe-2').buildIntent(
      context('mistral-voxtral-mini-transcribe-2'),
    );
    const body = intent.steps[0]?.body;
    expect(body?.kind).toBe('multipart');
    expect(body?.kind === 'multipart' ? body.fields.timestamp_granularities : undefined).toBe(
      'segment',
    );
  });

  test('parses provider-native speaker/timestamp fields without role mapping', () => {
    const samples = [
      {
        providerId: 'soniox-v5-async' as const,
        body: { tokens: [{ text: 'ajá', start_ms: 10, end_ms: 20, speaker: '9', language: 'es' }] },
      },
      {
        providerId: 'speechmatics-melia-1-batch' as const,
        body: {
          job: { duration: 2 },
          results: [
            {
              type: 'word',
              start_time: 0.1,
              end_time: 0.2,
              alternatives: [{ content: 'да', speaker: 'S7', language: 'ru' }],
            },
          ],
        },
      },
      {
        providerId: 'mistral-voxtral-mini-transcribe-2' as const,
        body: {
          model: 'voxtral-mini-2602',
          text: 'ajá',
          segments: [{ start: 0, end: 1, text: 'ajá', speaker: 3 }],
          usage: { prompt_audio_seconds: 1 },
        },
      },
      {
        providerId: 'deepgram-nova-3' as const,
        body: {
          metadata: { duration: 1, channels: 1 },
          results: {
            channels: [
              { alternatives: [{ words: [{ word: 'hello', start: 0, end: 1, speaker: 2 }] }] },
            ],
          },
        },
      },
      {
        providerId: 'elevenlabs-scribe-v2' as const,
        body: { words: [{ text: 'ajá', start: 0, end: 1, speaker_id: 'speaker_8', type: 'word' }] },
      },
    ];

    for (const sample of samples) {
      const parsed = getProviderAdapter(sample.providerId).parseResponse(sample.body);
      expect(parsed.nativeSegments[0]?.text).toMatch(/ajá|да|hello/u);
      expect(parsed.nativeSegments[0]?.speakerLabel).toBeDefined();
      expect(parsed.nativeSegments[0]).not.toHaveProperty('role');
    }
  });

  test.each(providerIds)('%s rejects an unrecognized response shape', (providerId) => {
    expect(() => getProviderAdapter(providerId).parseResponse({})).toThrow(
      /response|shape|schema/u,
    );
  });

  test('keeps Deepgram channel lineage when labels collide or are absent', () => {
    const adapter = getProviderAdapter('deepgram-nova-3');
    const sameLabel = adapter.parseResponse({
      metadata: { duration: 1, channels: 2 },
      results: {
        channels: [
          { alternatives: [{ words: [{ word: 'left', speaker: 0 }] }] },
          { alternatives: [{ words: [{ word: 'right', speaker: 0 }] }] },
        ],
      },
    });
    expect(
      sameLabel.nativeSegments.map((segment) => [segment.channelIndex, segment.speakerLabel]),
    ).toEqual([
      [0, '0'],
      [1, '0'],
    ]);

    const noLabel = adapter.parseResponse({
      results: {
        channels: [
          { alternatives: [{ words: [{ word: 'left' }] }] },
          { alternatives: [{ words: [{ word: 'right' }] }] },
        ],
      },
    });
    expect(
      noLabel.nativeSegments.map((segment) => [segment.channelIndex, segment.speakerLabel]),
    ).toEqual([
      [0, undefined],
      [1, undefined],
    ]);
    expect(noLabel.nativeSegments[0]).not.toHaveProperty('speakerLabel');
  });

  test('creates a deterministic Soniox reference from run and input identity', () => {
    const adapter = getProviderAdapter('soniox-v5-async');
    const first = adapter.buildIntent(context('soniox-v5-async', 'mixed_diarized'));
    const second = adapter.buildIntent({
      ...context('soniox-v5-async'),
      runId: 'run-2',
    });
    const firstReference = JSON.stringify(first.steps[0]?.body);
    const secondReference = JSON.stringify(second.steps[0]?.body);
    expect(firstReference).toContain('run-1');
    expect(firstReference).toContain('a'.repeat(64));
    expect(secondReference).toContain('run-2');
    expect(secondReference).not.toBe(firstReference);
    const firstBody = first.steps[0]?.body;
    expect(firstBody?.kind).toBe('multipart');
    const referenceLength =
      firstBody?.kind === 'multipart' ? (firstBody.fields.client_reference_id?.length ?? -1) : -1;
    expect(referenceLength).toBeLessThanOrEqual(256);
  });

  test('preserves Soniox model from the completed status response', async () => {
    const adapter = getProviderAdapter('soniox-v5-async');
    const input = {
      ...context('soniox-v5-async'),
      options: { pollIntervalMs: 0, maxWaitMs: 1_000 },
    };
    const responses = [
      { status: 201, body: '{"id":"file-1"}' },
      { status: 201, body: '{"id":"transcription-1","status":"queued"}' },
      {
        status: 200,
        body: '{"id":"transcription-1","status":"completed","model":"stt-async-v5","audio_duration_ms":1000}',
      },
      { status: 200, body: '{"id":"transcription-1","text":"hello","tokens":[]}' },
    ];
    let index = 0;
    const result = await adapter.execute(input, async () => {
      const response = responses[index++];
      if (!response) throw new Error('unexpected request');
      return { ...response, responsePath: `raw/${index}.response` };
    });

    expect(result.returnedModel).toBe('stt-async-v5');
    expect(index).toBe(4);
  });
});

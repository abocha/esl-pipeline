import {
  asRecord,
  numberValue,
  parseJsonBody,
  requireArrayResponse,
  segment,
  stringValue,
} from './common';
import type { ProviderAdapter, ProviderExecution, ProviderInput, RequestIntent } from './types';
import { ProviderExecutionError } from './types';

const model = 'voxtral-mini-2602';
const credentialEnv = 'MISTRAL_API_KEY';

function baseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  return (environment.MISTRAL_API_BASE_URL ?? 'https://api.mistral.ai/v1').replace(/\/$/u, '');
}

function buildRequest(input: ProviderInput): RequestIntent['steps'][number] {
  return {
    phase: 'transcribe',
    method: 'POST',
    url: `${baseUrl(input.environment)}/audio/transcriptions`,
    body: {
      kind: 'multipart',
      filePath: input.inputPath,
      fileField: 'file',
      fileName: input.fileName,
      fields: {
        model,
        diarize: 'true',
        timestamp_granularities: 'segment',
      },
    },
    credentialEnv,
    requestRisk: 'paid',
    description:
      'Direct standard transcription with diarization and segment/word timestamp intent.',
  };
}

export const mistralAdapter: ProviderAdapter = {
  id: 'mistral-voxtral-mini-transcribe-2',
  displayName: 'Mistral Voxtral Mini Transcribe 2 direct/standard',
  requestMode: 'direct',
  model,
  credentialEnv,
  buildIntent(input): RequestIntent {
    return {
      providerId: input.providerId,
      runMode: input.runMode,
      requestMode: 'direct',
      model,
      credentialEnv,
      steps: [buildRequest(input)],
      warnings: [
        'The public API documents timestamp_granularities as an array; Gate 0 observed that multipart field encoding is accepted for one item, so this harness requests segment timestamps only.',
        'The language field is intentionally omitted while timestamps are requested; confirm this compatibility in Gate 0.',
      ],
    };
  },
  parseResponse(body): ReturnType<ProviderAdapter['parseResponse']> {
    const root = asRecord(body);
    const hasSegments = Array.isArray(root.segments);
    const hasText = typeof root.text === 'string';
    if (!hasSegments && !hasText) {
      throw new Error('Mistral response did not contain the expected segments or text shape.');
    }
    const rawSegments = hasSegments
      ? requireArrayResponse(root.segments, 'Mistral', 'segments')
      : [];
    const nativeSegments = rawSegments.flatMap((value, index) => {
      const item = asRecord(value);
      const text = stringValue(item.text);
      if (!text) return [];
      const speaker = item.speaker ?? item.speaker_id;
      return [
        segment(
          {
            kind: 'segment',
            startMs: toMilliseconds(item.start),
            endMs: toMilliseconds(item.end),
            text,
            speakerLabel:
              typeof speaker === 'string' || typeof speaker === 'number'
                ? String(speaker)
                : undefined,
            language: stringValue(item.language) ?? stringValue(root.language),
          },
          index,
        ),
      ];
    });
    const fallbackText = stringValue(root.text);
    if (!nativeSegments.length && fallbackText) {
      nativeSegments.push(
        segment({ kind: 'text', text: fallbackText, language: stringValue(root.language) }, 0),
      );
    }
    const usageRoot = asRecord(root.usage);
    const audioDurationSec = numberValue(usageRoot.prompt_audio_seconds);
    return {
      nativeSegments,
      returnedModel: stringValue(root.model),
      usage:
        Object.keys(usageRoot).length === 0
          ? undefined
          : {
              audioDurationSec,
              source: 'provider',
              rawUsage: usageRoot,
            },
    };
  },
  async execute(input, request): Promise<ProviderExecution> {
    const response = await request('transcribe', {
      method: 'POST',
      url: `${baseUrl(input.environment)}/audio/transcriptions`,
      body: {
        kind: 'multipart',
        filePath: input.inputPath,
        fileField: 'file',
        fileName: input.fileName,
        fields: {
          model,
          diarize: 'true',
          timestamp_granularities: 'segment',
        },
      },
      credentialEnv,
      requestRisk: 'paid',
    });
    let parsed: ReturnType<typeof mistralAdapter.parseResponse>;
    try {
      parsed = mistralAdapter.parseResponse(parseJsonBody(response.body));
    } catch (error: unknown) {
      throw new ProviderExecutionError(
        `Mistral transcription response could not be parsed after a successful paid request; the harness failed closed. ${error instanceof Error ? error.message : String(error)}`,
        'uncertain',
        'response_unparseable',
      );
    }
    return { ...parsed, rawResponsePaths: response.responsePath ? [response.responsePath] : [] };
  },
};

function toMilliseconds(value: unknown): number | undefined {
  const seconds = numberValue(value);
  return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

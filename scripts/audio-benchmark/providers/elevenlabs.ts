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

const model = 'scribe_v2';
const credentialEnv = 'ELEVENLABS_API_KEY';

function baseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  return (environment.ELEVENLABS_API_BASE_URL ?? 'https://api.elevenlabs.io/v1').replace(
    /\/$/u,
    '',
  );
}

function buildRequest(input: ProviderInput): RequestIntent['steps'][number] {
  return {
    phase: 'transcribe',
    method: 'POST',
    url: `${baseUrl(input.environment)}/speech-to-text`,
    body: {
      kind: 'multipart',
      filePath: input.inputPath,
      fileField: 'file',
      fileName: input.fileName,
      fields: {
        model_id: model,
        timestamps_granularity: 'word',
        diarize: 'true',
        use_multi_channel: 'false',
        no_verbatim: 'false',
      },
    },
    credentialEnv,
    requestRisk: 'paid',
    description: 'Transcribe the prepared mixed artifact with Scribe v2 speaker diarization.',
  };
}

export const elevenLabsAdapter: ProviderAdapter = {
  id: 'elevenlabs-scribe-v2',
  displayName: 'ElevenLabs Scribe v2',
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
        'use_multi_channel=false keeps this benchmark lane comparable to mixed single-file diarization.',
      ],
    };
  },
  parseResponse(body): ReturnType<ProviderAdapter['parseResponse']> {
    const root = asRecord(body);
    const nativeSegments = requireArrayResponse(root.words, 'ElevenLabs', 'words').flatMap(
      (word, index) => {
        const item = asRecord(word);
        const text = stringValue(item.text);
        if (!text) return [];
        const speaker = item.speaker_id;
        return [
          segment(
            {
              kind: stringValue(item.type) ?? 'word',
              startMs: toMilliseconds(item.start),
              endMs: toMilliseconds(item.end),
              text,
              speakerLabel: stringValue(speaker),
              channelIndex: numberValue(item.channel_index),
            },
            index,
          ),
        ];
      },
    );
    const usageRoot = asRecord(root.usage);
    return {
      nativeSegments,
      usage:
        Object.keys(usageRoot).length === 0
          ? undefined
          : { source: 'provider', rawUsage: usageRoot },
    };
  },
  async execute(input, request): Promise<ProviderExecution> {
    const response = await request('transcribe', {
      method: 'POST',
      url: `${baseUrl(input.environment)}/speech-to-text`,
      body: {
        kind: 'multipart',
        filePath: input.inputPath,
        fileField: 'file',
        fileName: input.fileName,
        fields: {
          model_id: model,
          timestamps_granularity: 'word',
          diarize: 'true',
          use_multi_channel: 'false',
          no_verbatim: 'false',
        },
      },
      credentialEnv,
      requestRisk: 'paid',
    });
    let parsed: ReturnType<typeof elevenLabsAdapter.parseResponse>;
    try {
      parsed = elevenLabsAdapter.parseResponse(parseJsonBody(response.body));
    } catch (error: unknown) {
      throw new ProviderExecutionError(
        `ElevenLabs transcription response could not be parsed after a successful paid request; the harness failed closed. ${error instanceof Error ? error.message : String(error)}`,
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

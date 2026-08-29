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
      fields: requestFields(input),
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
              logprob: numberValue(item.logprob),
            },
            index,
          ),
        ];
      },
    );
    const usageRoot = asRecord(root.usage);
    const audioDurationSec = numberValue(root.audio_duration_secs);
    const providerMetadata = Object.fromEntries(
      [
        ['language_code', stringValue(root.language_code)],
        ['language_probability', numberValue(root.language_probability)],
        ['transcription_id', stringValue(root.transcription_id)],
        ['audio_duration_secs', audioDurationSec],
      ].filter(([, value]) => value !== undefined),
    );
    const rawUsage = {
      ...usageRoot,
      ...(audioDurationSec === undefined ? {} : { audio_duration_secs: audioDurationSec }),
    };
    return {
      nativeSegments,
      providerMetadata: Object.keys(providerMetadata).length === 0 ? undefined : providerMetadata,
      usage:
        Object.keys(rawUsage).length === 0
          ? undefined
          : { audioDurationSec, source: 'provider', rawUsage },
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
        fields: requestFields(input),
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

function requestFields(input: ProviderInput): Record<string, string> {
  const fields: Record<string, string> = {
    model_id: model,
    timestamps_granularity: 'word',
    diarize: 'true',
    use_multi_channel: 'false',
    no_verbatim: 'false',
  };
  const numSpeakers = numberValue(input.options.numSpeakers);
  if (numSpeakers !== undefined) fields.num_speakers = String(numSpeakers);
  const diarizationThreshold = numberValue(input.options.diarizationThreshold);
  if (diarizationThreshold !== undefined) {
    fields.diarization_threshold = String(diarizationThreshold);
  }
  return fields;
}

function toMilliseconds(value: unknown): number | undefined {
  const seconds = numberValue(value);
  return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

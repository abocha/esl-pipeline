import {
  asArray,
  asRecord,
  numberValue,
  parseJsonBody,
  requireArrayResponse,
  segment,
  stringValue,
} from './common';
import type { ProviderAdapter, ProviderExecution, ProviderInput, RequestIntent } from './types';
import { ProviderExecutionError } from './types';

const model = 'nova-3';
const credentialEnv = 'DEEPGRAM_API_KEY';

function baseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  return (environment.DEEPGRAM_API_BASE_URL ?? 'https://api.deepgram.com/v1').replace(/\/$/u, '');
}

function contentType(fileName: string): string {
  const extension = fileName.toLowerCase().split('.').at(-1);
  return extension === 'wav'
    ? 'audio/wav'
    : extension === 'mp3'
      ? 'audio/mpeg'
      : 'application/octet-stream';
}

function listenUrl(input: ProviderInput): string {
  const query = new URLSearchParams({
    model,
    language: 'multi',
    utterances: 'true',
    punctuate: 'true',
    filler_words: 'true',
  });
  if (input.runMode === 'trusted_split_control') {
    query.set('multichannel', 'true');
  } else {
    query.set('diarize_model', 'latest');
  }
  return `${baseUrl(input.environment)}/listen?${query.toString()}`;
}

function buildRequest(input: ProviderInput): RequestIntent['steps'][number] {
  return {
    phase: 'transcribe',
    method: 'POST',
    url: listenUrl(input),
    body: { kind: 'binary', filePath: input.inputPath, contentType: contentType(input.fileName) },
    credentialEnv,
    requestRisk: 'paid',
    description:
      input.runMode === 'trusted_split_control'
        ? 'Transcribe the original trusted split-channel source as the incumbent control.'
        : 'Transcribe the prepared mixed artifact with speaker diarization.',
  };
}

export const deepgramAdapter: ProviderAdapter = {
  id: 'deepgram-nova-3',
  displayName: 'Deepgram Nova-3',
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
        'The split control and mixed diarized request modes are intentionally separate runs.',
      ],
    };
  },
  parseResponse(body): ReturnType<ProviderAdapter['parseResponse']> {
    const root = asRecord(body);
    const metadata = asRecord(root.metadata);
    if (root.results === null || typeof root.results !== 'object' || Array.isArray(root.results)) {
      throw new Error('Deepgram response did not contain the expected results object.');
    }
    const channels = requireArrayResponse(
      (root.results as Record<string, unknown>).channels,
      'Deepgram',
      'results.channels',
    );
    let nativeIndex = 0;
    const nativeSegments = channels.flatMap((channel, channelIndex) => {
      const alternatives = asArray(asRecord(channel).alternatives);
      const words = asArray(asRecord(alternatives[0]).words);
      return words.flatMap((word) => {
        const item = asRecord(word);
        const text = stringValue(item.punctuated_word) ?? stringValue(item.word);
        if (!text) return [];
        const speaker = item.speaker;
        const speakerLabel =
          typeof speaker === 'string' || typeof speaker === 'number' ? String(speaker) : undefined;
        const nativeSegment = segment(
          {
            kind: 'word',
            startMs: toMilliseconds(item.start),
            endMs: toMilliseconds(item.end),
            text,
            ...(speakerLabel === undefined ? {} : { speakerLabel }),
            channelIndex,
            confidence: numberValue(item.confidence),
          },
          nativeIndex,
        );
        nativeIndex += 1;
        return [nativeSegment];
      });
    });
    const duration = numberValue(metadata.duration);
    const modelIds = asArray(metadata.models);
    const firstModelId = stringValue(modelIds[0]);
    const modelInfo = firstModelId
      ? asRecord(asRecord(metadata.model_info)[firstModelId])
      : undefined;
    return {
      nativeSegments,
      returnedModel:
        stringValue(metadata.model) ?? stringValue(modelInfo?.arch) ?? stringValue(modelInfo?.name),
      usage:
        Object.keys(metadata).length === 0
          ? undefined
          : {
              audioDurationSec: duration,
              source: 'provider',
              rawUsage: { metadata },
            },
    };
  },
  async execute(input, request): Promise<ProviderExecution> {
    const response = await request('transcribe', {
      method: 'POST',
      url: listenUrl(input),
      body: { kind: 'binary', filePath: input.inputPath, contentType: contentType(input.fileName) },
      credentialEnv,
      requestRisk: 'paid',
    });
    let parsed: ReturnType<typeof deepgramAdapter.parseResponse>;
    try {
      parsed = deepgramAdapter.parseResponse(parseJsonBody(response.body));
    } catch (error: unknown) {
      throw new ProviderExecutionError(
        `Deepgram transcription response could not be parsed after a successful paid request; the harness failed closed. ${error instanceof Error ? error.message : String(error)}`,
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

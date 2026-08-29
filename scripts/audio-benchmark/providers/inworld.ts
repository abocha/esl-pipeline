import { asRecord, numberValue, segment, stringValue } from './common';
import type {
  ParsedProviderResponse,
  ProviderAdapter,
  ProviderExecution,
  ProviderInput,
  ProviderStreamClient,
  RequestIntent,
} from './types';
import { ProviderExecutionError } from './types';

const model = 'inworld/inworld-stt-1';
const credentialEnv = 'INWORLD_API_KEY';
const streamUrl = 'wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional';

export function buildInworldConfig(_input: ProviderInput): Record<string, unknown> {
  return {
    modelId: model,
    audioEncoding: 'LINEAR16',
    sampleRateHertz: 16_000,
    numberOfChannels: 1,
    enableSpeakerDiarization: true,
    includeWordTimestamps: true,
  };
}

export function parseInworldMessages(messages: string[]): ParsedProviderResponse {
  let finalTranscriptionCount = 0;
  let interimTranscriptionCount = 0;
  let speechStartedCount = 0;
  let speechStoppedCount = 0;
  let nativeIndex = 0;
  let usageValue: Record<string, unknown> | undefined;
  const nativeSegments = [] as ParsedProviderResponse['nativeSegments'];

  for (const message of messages) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message) as unknown;
    } catch {
      throw new Error('Inworld WebSocket response was not valid JSON.');
    }
    const root = asRecord(parsed);
    if (Object.hasOwn(root, 'error')) {
      throw new Error(`Inworld WebSocket returned an error: ${JSON.stringify(root.error)}`);
    }
    const result = root.result;
    if (result === null || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Inworld WebSocket response did not contain the expected result envelope.');
    }
    const resultRecord = result as Record<string, unknown>;
    const recognized = Object.keys(resultRecord).filter((key) =>
      ['transcription', 'usage', 'speechStarted', 'speechStopped'].includes(key),
    );
    if (
      Object.keys(resultRecord).length !== 1 ||
      recognized.length !== 1 ||
      recognized[0] !== Object.keys(resultRecord)[0]
    ) {
      throw new Error('Inworld WebSocket response contained an unrecognized event shape.');
    }

    if (Object.hasOwn(resultRecord, 'transcription')) {
      const transcription = asRecord(resultRecord.transcription);
      if (
        typeof transcription.transcript !== 'string' ||
        typeof transcription.isFinal !== 'boolean'
      ) {
        throw new Error('Inworld transcription event did not contain transcript and isFinal.');
      }
      if (!Array.isArray(transcription.wordTimestamps)) {
        throw new Error('Inworld transcription event did not contain wordTimestamps.');
      }
      if (transcription.isFinal) finalTranscriptionCount += 1;
      else interimTranscriptionCount += 1;
      if (!transcription.isFinal) continue;
      if (transcription.wordTimestamps.length === 0 && transcription.transcript.trim().length > 0) {
        nativeSegments.push(
          segment(
            {
              kind: 'turn',
              text: transcription.transcript,
            },
            nativeIndex,
          ),
        );
        nativeIndex += 1;
        continue;
      }
      for (const [index, value] of transcription.wordTimestamps.entries()) {
        const word = asRecord(value);
        const text = stringValue(word.word) ?? stringValue(word.text);
        if (!text) throw new Error('Inworld word timestamp did not contain lexical text.');
        const speaker = word.speakerId ?? word.speaker;
        nativeSegments.push(
          segment(
            {
              kind: 'word',
              startMs: inworldTimestampMs(word, 'start'),
              endMs: inworldTimestampMs(word, 'end'),
              text,
              ...(typeof speaker === 'string' || typeof speaker === 'number'
                ? { speakerLabel: String(speaker) }
                : {}),
              language: stringValue(word.languageCode) ?? stringValue(word.language),
              confidence: numberValue(word.confidence),
            },
            nativeIndex + index,
          ),
        );
      }
      nativeIndex += transcription.wordTimestamps.length;
    } else if (Object.hasOwn(resultRecord, 'usage')) {
      const usage = resultRecord.usage;
      if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) {
        throw new Error('Inworld usage event had an unrecognized shape.');
      }
      const usageRecord = usage as Record<string, unknown>;
      const transcribedAudioMs = numberValue(usageRecord.transcribedAudioMs);
      if (
        transcribedAudioMs === undefined ||
        !Number.isFinite(transcribedAudioMs) ||
        transcribedAudioMs < 0 ||
        typeof usageRecord.modelId !== 'string' ||
        usageRecord.modelId.length === 0
      ) {
        throw new Error(
          'Inworld usage requires a finite non-negative transcribedAudioMs and modelId.',
        );
      }
      usageValue = usage as Record<string, unknown>;
    } else if (Object.hasOwn(resultRecord, 'speechStarted')) {
      if (resultRecord.speechStarted === null || typeof resultRecord.speechStarted !== 'object') {
        throw new Error('Inworld speechStarted event had an unrecognized shape.');
      }
      speechStartedCount += 1;
    } else if (Object.hasOwn(resultRecord, 'speechStopped')) {
      if (resultRecord.speechStopped === null || typeof resultRecord.speechStopped !== 'object') {
        throw new Error('Inworld speechStopped event had an unrecognized shape.');
      }
      speechStoppedCount += 1;
    }
  }

  if (finalTranscriptionCount === 0) {
    throw new Error('Inworld response did not contain a final transcription event.');
  }

  const audioDurationMs = numberValue(usageValue?.transcribedAudioMs);
  return {
    nativeSegments,
    returnedModel: stringValue(usageValue?.modelId),
    usage:
      usageValue === undefined
        ? undefined
        : {
            audioDurationSec: audioDurationMs === undefined ? undefined : audioDurationMs / 1000,
            source: 'provider',
            rawUsage: usageValue,
          },
    providerMetadata: {
      responseEventCounts: {
        finalTranscription: finalTranscriptionCount,
        interimTranscription: interimTranscriptionCount,
        speechStarted: speechStartedCount,
        speechStopped: speechStoppedCount,
        usage: usageValue === undefined ? 0 : 1,
      },
    },
  };
}

export const inworldAdapter: ProviderAdapter = {
  id: 'inworld-stt-1',
  displayName: 'Inworld STT-1 WebSocket',
  requestMode: 'websocket',
  model,
  credentialEnv,
  buildIntent(input): RequestIntent {
    return {
      providerId: input.providerId,
      runMode: input.runMode,
      requestMode: 'websocket',
      model,
      credentialEnv,
      steps: [
        {
          phase: 'transcribe',
          method: 'WS',
          url: input.environment?.INWORLD_API_BASE_URL
            ? `${input.environment.INWORLD_API_BASE_URL.replace(/\/$/u, '')}/stt/v1/transcribe:streamBidirectional`
            : streamUrl,
          body: { kind: 'json', value: { transcribeConfig: buildInworldConfig(input) } },
          credentialEnv,
          description: 'Stream the verified prepared PCM payload over one Inworld WebSocket.',
          requestRisk: 'paid',
        },
      ],
      warnings: [
        `The WebSocket sender uses ${String(inworldPacing(input.options.inworldPacing))}x audio pacing ("unpaced" means callback-flow-control only).`,
        'After audio, the sender follows the official example finalization sequence: 350 ms trailing delay, endTurn, 1500 ms response quiescence, then closeStream.',
        'Inworld documents speaker diarization as Experimental; no language is forced by this benchmark configuration.',
      ],
    };
  },
  parseResponse(body): ParsedProviderResponse {
    if (!Array.isArray(body) || !body.every((item) => typeof item === 'string')) {
      throw new Error('Inworld response parser requires the received WebSocket message array.');
    }
    return parseInworldMessages(body);
  },
  async execute(
    input: ProviderInput,
    _request,
    stream?: ProviderStreamClient,
  ): Promise<ProviderExecution> {
    if (!stream) {
      throw new ProviderExecutionError(
        'Inworld requires the benchmark WebSocket transport; no stream transport was supplied.',
        'failed',
        'missing_stream_transport',
      );
    }
    const response = await stream('transcribe', {
      url: input.environment?.INWORLD_API_BASE_URL
        ? `${input.environment.INWORLD_API_BASE_URL.replace(/\/$/u, '')}/stt/v1/transcribe:streamBidirectional`
        : streamUrl,
      config: buildInworldConfig(input),
      filePath: input.inputPath,
      fileName: input.fileName,
      sampleRateHz: 16_000,
      channels: 1,
      chunkBytes: 3_200,
      credentialEnv,
      description: 'Stream the verified prepared PCM payload over one Inworld WebSocket.',
      requestRisk: 'paid',
      pacing: inworldPacing(input.options.inworldPacing),
      endOfAudioDelayMs: 350,
      quietPeriodBeforeCloseMs: 1_500,
      physicalCloseGraceMs: 2_500,
      maxWaitMs: numericOption(input.options.maxWaitMs) ?? 120_000,
    });
    let parsed: ParsedProviderResponse;
    try {
      parsed = parseInworldMessages(response.logicalResultMessages);
    } catch (error: unknown) {
      throw new ProviderExecutionError(
        `Inworld transcription response could not be parsed after the WebSocket stream; the harness failed closed. ${error instanceof Error ? error.message : String(error)}`,
        'uncertain',
        'response_unparseable',
      );
    }
    return {
      ...parsed,
      providerMetadata: {
        ...(parsed.providerMetadata ?? {}),
        requestConfig: buildInworldConfig(input),
        stream: {
          outboundAudioBytes: response.outboundAudioBytes,
          outboundAudioSha256: response.outboundAudioSha256,
          outboundAudioChunkCount: response.outboundAudioChunkCount,
          pacing: inworldPacing(input.options.inworldPacing),
          sendElapsedMs: response.sendElapsedMs,
          audioStartedElapsedMs: response.audioStartedElapsedMs,
          audioFinishedElapsedMs: response.audioFinishedElapsedMs,
          endTurnSentElapsedMs: response.endTurnSentElapsedMs,
          closeStreamSentElapsedMs: response.closeStreamSentElapsedMs,
          finalResultElapsedMs: response.finalResultElapsedMs,
          usageElapsedMs: response.usageElapsedMs,
          logicalCompletionElapsedMs: response.logicalCompletionElapsedMs,
          physicalSocketBehavior: response.physicalSocketBehavior,
          physicalCloseElapsedMs: response.physicalCloseElapsedMs,
          totalElapsedMs: response.totalElapsedMs,
        },
      },
      rawResponsePaths: response.responsePath ? [response.responsePath] : [],
    };
  },
};

function inworldPacing(value: unknown): 'unpaced' | number {
  if (value === undefined) return 1;
  if (value === 'unpaced') return value;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  throw new Error('Inworld pacing must be "unpaced" or a positive audio-rate multiplier.');
}

function numericOption(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function inworldTimestampMs(
  item: Record<string, unknown>,
  edge: 'start' | 'end',
): number | undefined {
  const milliseconds = numberValue(item[`${edge}TimeMs`]) ?? numberValue(item[`${edge}Ms`]);
  if (milliseconds !== undefined) return milliseconds;
  const seconds = numberValue(item[`${edge}TimeSeconds`]);
  return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

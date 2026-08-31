import { sha256Text } from '../manifest';
import {
  asRecord,
  numberValue,
  parseJsonBody,
  parseSubmissionObject,
  recordExternalReference,
  requireArrayResponse,
  segment,
  stringValue,
} from './common';
import type { ProviderAdapter, ProviderExecution, ProviderInput, RequestIntent } from './types';
import { ProviderExecutionError } from './types';

const model = 'stt-async-v5';
const credentialEnv = 'SONIOX_API_KEY';

function baseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  return (environment.SONIOX_API_BASE_URL ?? 'https://api.soniox.com/v1').replace(/\/$/u, '');
}

function reference(input: ProviderInput): string {
  const runId = input.runId ?? 'unknown-run';
  const inputSha = input.selectedInputSha256 ?? 'unknown-input';
  const value = `audio-benchmark-${runId}-${inputSha}`;
  if (value.length <= 256) return value;
  return `audio-benchmark-${runId.slice(0, 96)}-${inputSha}-${sha256Text(runId).slice(0, 64)}`.slice(
    0,
    256,
  );
}

function buildSteps(input: ProviderInput): RequestIntent['steps'] {
  const root = baseUrl(input.environment);
  return [
    {
      phase: 'upload',
      method: 'POST',
      url: `${root}/files`,
      body: {
        kind: 'multipart',
        filePath: input.inputPath,
        fileField: 'file',
        fileName: input.fileName,
        fields: { client_reference_id: reference(input) },
      },
      credentialEnv,
      description: 'Upload the immutable prepared artifact to Soniox Files API.',
      requestRisk: 'paid',
    },
    {
      phase: 'submit',
      method: 'POST',
      url: `${root}/transcriptions`,
      body: {
        kind: 'json',
        value: {
          model,
          file_id: '<upload-file-id>',
          language_hints: ['en', 'ru'],
          enable_language_identification: true,
          enable_speaker_diarization: true,
          client_reference_id: reference(input),
        },
      },
      credentialEnv,
      description: 'Create an asynchronous diarized transcription.',
      requestRisk: 'paid',
    },
    {
      phase: 'poll',
      method: 'GET',
      url: `${root}/transcriptions/<transcription-id>`,
      credentialEnv,
      description: 'Poll the existing transcription until it reaches a terminal state.',
      requestRisk: 'external_state',
    },
    {
      phase: 'result',
      method: 'GET',
      url: `${root}/transcriptions/<transcription-id>/transcript`,
      credentialEnv,
      description: 'Retrieve the immutable completed transcript response.',
      requestRisk: 'external_state',
    },
  ];
}

export const sonioxAdapter: ProviderAdapter = {
  id: 'soniox-v5-async',
  displayName: 'Soniox v5 Async',
  requestMode: 'async_file',
  model,
  credentialEnv,
  buildIntent(input): RequestIntent {
    return {
      providerId: input.providerId,
      runMode: input.runMode,
      requestMode: 'async_file',
      model,
      credentialEnv,
      steps: buildSteps(input),
      warnings: [
        'Async requests are separate physical attempts; the harness fails closed and records external IDs. Recovery is an operator/manual provider inspection boundary; no resume command is provided.',
      ],
    };
  },
  parseResponse(body): ReturnType<ProviderAdapter['parseResponse']> {
    const root = asRecord(body);
    const nativeSegments = requireArrayResponse(root.tokens, 'Soniox', 'tokens').flatMap(
      (token, index) => {
        const item = asRecord(token);
        const text = stringValue(item.text);
        if (!text) return [];
        const speaker = item.speaker;
        return [
          segment(
            {
              kind: stringValue(item.type) ?? 'token',
              startMs: numberValue(item.start_ms),
              endMs: numberValue(item.end_ms),
              text,
              speakerLabel:
                typeof speaker === 'string' || typeof speaker === 'number'
                  ? String(speaker)
                  : undefined,
              language: stringValue(item.language),
              isAudioEvent:
                item.is_audio_event === null || typeof item.is_audio_event === 'boolean'
                  ? item.is_audio_event
                  : undefined,
              confidence: numberValue(item.confidence),
            },
            index,
          ),
        ];
      },
    );
    const usage = numberValue(root.audio_duration_ms);
    const usageRoot = asRecord(root.usage);
    const rawUsage = {
      ...usageRoot,
      ...(usage === undefined ? {} : { audio_duration_ms: usage }),
    };
    return {
      nativeSegments,
      usage:
        Object.keys(rawUsage).length === 0
          ? undefined
          : {
              audioDurationSec: usage === undefined ? undefined : usage / 1000,
              source: 'provider',
              rawUsage,
            },
    };
  },
  async execute(input, request): Promise<ProviderExecution> {
    const root = baseUrl(input.environment);
    const rawResponsePaths: string[] = [];
    const uploaded = await request('upload', {
      method: 'POST',
      url: `${root}/files`,
      body: {
        kind: 'multipart',
        filePath: input.inputPath,
        fileField: 'file',
        fileName: input.fileName,
        fields: { client_reference_id: reference(input) },
      },
      credentialEnv,
      requestRisk: 'paid',
    });
    if (uploaded.responsePath) rawResponsePaths.push(uploaded.responsePath);
    const uploadBody = parseSubmissionObject(uploaded.body, 'Soniox upload');
    const fileId = stringValue(uploadBody.id);
    if (fileId) await recordExternalReference(input, { kind: 'file', id: fileId });
    if (!fileId)
      throw new ProviderExecutionError(
        'Soniox upload response did not contain a file id; the harness failed closed and recorded the external attempt.',
        'uncertain',
        'submission_id_missing',
      );

    const submitted = await request('submit', {
      method: 'POST',
      url: `${root}/transcriptions`,
      body: {
        kind: 'json',
        value: {
          model,
          file_id: fileId,
          language_hints: ['en', 'ru'],
          enable_language_identification: true,
          enable_speaker_diarization: true,
          client_reference_id: reference(input),
        },
      },
      credentialEnv,
      requestRisk: 'paid',
    });
    if (submitted.responsePath) rawResponsePaths.push(submitted.responsePath);
    const submittedBody = parseSubmissionObject(submitted.body, 'Soniox transcription');
    const transcriptionId = stringValue(submittedBody.id);
    if (transcriptionId)
      await recordExternalReference(input, { kind: 'transcription', id: transcriptionId });
    if (!transcriptionId)
      throw new ProviderExecutionError(
        'Soniox submission did not contain a transcription id; the harness failed closed and recorded the external attempt.',
        'uncertain',
        'submission_id_missing',
      );

    const startedAt = Date.now();
    const maxWaitMs = optionNumber(input, 'maxWaitMs', 6 * 60 * 60 * 1000);
    const pollIntervalMs = optionNumber(input, 'pollIntervalMs', 5000);
    let latestStatus = submittedBody;
    while (true) {
      const statusResponse = await request('poll', {
        method: 'GET',
        url: `${root}/transcriptions/${encodeURIComponent(transcriptionId)}`,
        credentialEnv,
      });
      if (statusResponse.responsePath) rawResponsePaths.push(statusResponse.responsePath);
      latestStatus = asRecord(parseJsonBody(statusResponse.body));
      const status = stringValue(latestStatus.status);
      if (status === 'completed') break;
      if (status === 'error') {
        throw new ProviderExecutionError(
          stringValue(latestStatus.error_message) ?? 'Soniox transcription failed.',
          'failed',
          stringValue(latestStatus.error_type) ?? 'provider_error',
        );
      }
      if (Date.now() - startedAt >= maxWaitMs) {
        throw new ProviderExecutionError(
          `Soniox transcription ${transcriptionId} did not finish before maxWaitMs; the harness failed closed and recorded the external ID. Recovery is an operator/manual provider inspection boundary; no resume command is provided.`,
          'uncertain',
          'async_timeout',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    const transcript = await request('result', {
      method: 'GET',
      url: `${root}/transcriptions/${encodeURIComponent(transcriptionId)}/transcript`,
      credentialEnv,
    });
    if (transcript.responsePath) rawResponsePaths.push(transcript.responsePath);
    let parsed: ReturnType<typeof sonioxAdapter.parseResponse>;
    try {
      parsed = sonioxAdapter.parseResponse(parseJsonBody(transcript.body));
    } catch (error: unknown) {
      throw new ProviderExecutionError(
        `Soniox transcript response could not be parsed for transcription ${transcriptionId}; the harness failed closed and recorded the external ID. ${error instanceof Error ? error.message : String(error)}`,
        'uncertain',
        'response_unparseable',
      );
    }
    const audioDurationMs = numberValue(latestStatus.audio_duration_ms);
    if (audioDurationMs !== undefined) {
      parsed.usage = {
        ...(parsed.usage ?? { source: 'provider' }),
        audioDurationSec: audioDurationMs / 1000,
        source: 'provider',
        rawUsage: { status: latestStatus, ...(parsed.usage?.rawUsage ?? {}) },
      };
    }
    return {
      ...parsed,
      returnedModel: parsed.returnedModel ?? stringValue(latestStatus.model),
      rawResponsePaths,
    };
  },
};

function optionNumber(input: ProviderInput, key: string, fallback: number): number {
  const value = input.options[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

import {
  asArray,
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

const model = 'melia-1';
const credentialEnv = 'SPEECHMATICS_API_KEY';

function baseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  return (
    environment.SPEECHMATICS_API_BASE_URL ?? 'https://eu1.asr.api.speechmatics.com/v2'
  ).replace(/\/$/u, '');
}

function config(): Record<string, unknown> {
  return {
    type: 'transcription',
    transcription_config: {
      model,
      language: 'multi',
      language_hints: ['en', 'ru'],
      diarization: 'speaker',
    },
    transcript_filtering_config: {
      remove_disfluencies: false,
    },
  };
}

function buildSteps(input: ProviderInput): RequestIntent['steps'] {
  const root = baseUrl(input.environment);
  return [
    {
      phase: 'submit',
      method: 'POST',
      url: `${root}/jobs/`,
      body: {
        kind: 'multipart',
        filePath: input.inputPath,
        fileField: 'data_file',
        fileName: input.fileName,
        fields: { config: JSON.stringify(config()) },
      },
      credentialEnv,
      description: 'Submit the immutable prepared artifact as a Melia 1 batch job.',
      requestRisk: 'paid',
    },
    {
      phase: 'poll',
      method: 'GET',
      url: `${root}/jobs/<job-id>?wait=0`,
      credentialEnv,
      description: 'Poll the existing Speechmatics batch job.',
      requestRisk: 'external_state',
    },
    {
      phase: 'result',
      method: 'GET',
      url: `${root}/jobs/<job-id>/transcript?format=json-v2`,
      credentialEnv,
      description: 'Retrieve the JSON v2 transcript with words and speaker labels.',
      requestRisk: 'external_state',
    },
  ];
}

export const speechmaticsAdapter: ProviderAdapter = {
  id: 'speechmatics-melia-1-batch',
  displayName: 'Speechmatics Melia 1 Batch',
  requestMode: 'batch',
  model,
  credentialEnv,
  buildIntent(input): RequestIntent {
    return {
      providerId: input.providerId,
      runMode: input.runMode,
      requestMode: 'batch',
      model,
      credentialEnv,
      steps: buildSteps(input),
      warnings: [
        'Speechmatics region is selected by SPEECHMATICS_API_BASE_URL; billing is not inferred by the adapter.',
      ],
    };
  },
  parseResponse(body): ReturnType<ProviderAdapter['parseResponse']> {
    const root = asRecord(body);
    const nativeSegments = requireArrayResponse(root.results, 'Speechmatics', 'results').flatMap(
      (result, index) => {
        const item = asRecord(result);
        const alternative = asRecord(asArray(item.alternatives)[0]);
        const text = stringValue(alternative.content) ?? stringValue(item.content);
        if (!text) return [];
        const speaker =
          stringValue(alternative.speaker) ??
          stringValue(item.speaker) ??
          stringValue(alternative.channel) ??
          stringValue(item.channel);
        return [
          segment(
            {
              kind: stringValue(item.type) ?? 'result',
              startMs: toMilliseconds(item.start_time),
              endMs: toMilliseconds(item.end_time),
              text,
              speakerLabel: speaker,
              language: stringValue(alternative.language) ?? stringValue(item.language),
              confidence: numberValue(alternative.confidence),
            },
            index,
          ),
        ];
      },
    );
    const job = asRecord(root.job);
    const duration = numberValue(job.duration);
    return {
      nativeSegments,
      returnedModel:
        stringValue(asRecord(asRecord(root.metadata).transcription_config).model) ??
        stringValue(job.model),
      usage:
        Object.keys(job).length === 0
          ? undefined
          : {
              audioDurationSec: duration,
              billableDurationSec: duration,
              source: 'calculated',
              rawUsage: { job },
            },
    };
  },
  async execute(input, request): Promise<ProviderExecution> {
    const root = baseUrl(input.environment);
    const rawResponsePaths: string[] = [];
    const submitted = await request('submit', {
      method: 'POST',
      url: `${root}/jobs/`,
      body: {
        kind: 'multipart',
        filePath: input.inputPath,
        fileField: 'data_file',
        fileName: input.fileName,
        fields: { config: JSON.stringify(config()) },
      },
      credentialEnv,
      requestRisk: 'paid',
    });
    if (submitted.responsePath) rawResponsePaths.push(submitted.responsePath);
    const submittedBody = parseSubmissionObject(submitted.body, 'Speechmatics job');
    const submittedJob = asRecord(submittedBody.job);
    const jobId = stringValue(submittedBody.id) ?? stringValue(submittedJob.id);
    if (jobId) await recordExternalReference(input, { kind: 'job', id: jobId });
    if (!jobId)
      throw new ProviderExecutionError(
        'Speechmatics submission did not contain a job id; the harness failed closed and recorded the external attempt.',
        'uncertain',
        'submission_id_missing',
      );

    const startedAt = Date.now();
    const maxWaitMs = optionNumber(input, 'maxWaitMs', 6 * 60 * 60 * 1000);
    const pollIntervalMs = optionNumber(input, 'pollIntervalMs', 5000);
    let latestStatus: Record<string, unknown> = submittedJob;
    while (true) {
      const statusResponse = await request('poll', {
        method: 'GET',
        url: `${root}/jobs/${encodeURIComponent(jobId)}?wait=0`,
        credentialEnv,
        requestRisk: 'external_state',
      });
      if (statusResponse.responsePath) rawResponsePaths.push(statusResponse.responsePath);
      const statusBody = asRecord(parseJsonBody(statusResponse.body));
      latestStatus = asRecord(statusBody.job);
      const status = stringValue(latestStatus.status);
      if (status === 'done') break;
      if (status === 'rejected') {
        throw new ProviderExecutionError(
          stringValue(latestStatus.error) ?? 'Speechmatics batch job was rejected.',
          'failed',
          'provider_error',
        );
      }
      if (Date.now() - startedAt >= maxWaitMs) {
        throw new ProviderExecutionError(
          `Speechmatics job ${jobId} did not finish before maxWaitMs; the harness failed closed and recorded the external ID. Recovery is an operator/manual provider inspection boundary; no resume command is provided.`,
          'uncertain',
          'async_timeout',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    const transcript = await request('result', {
      method: 'GET',
      url: `${root}/jobs/${encodeURIComponent(jobId)}/transcript?format=json-v2`,
      credentialEnv,
      requestRisk: 'external_state',
    });
    if (transcript.responsePath) rawResponsePaths.push(transcript.responsePath);
    let parsed: ReturnType<typeof speechmaticsAdapter.parseResponse>;
    try {
      parsed = speechmaticsAdapter.parseResponse(parseJsonBody(transcript.body));
    } catch (error: unknown) {
      throw new ProviderExecutionError(
        `Speechmatics transcript response could not be parsed for job ${jobId}; the harness failed closed and recorded the external ID. ${error instanceof Error ? error.message : String(error)}`,
        'uncertain',
        'response_unparseable',
      );
    }
    const duration = numberValue(latestStatus.duration);
    if (duration !== undefined) {
      parsed.usage = {
        ...(parsed.usage ?? { source: 'provider' }),
        audioDurationSec: duration,
        billableDurationSec: duration,
        source: 'calculated',
        rawUsage: { status: latestStatus, ...(parsed.usage?.rawUsage ?? {}) },
      };
    }
    return { ...parsed, rawResponsePaths };
  },
};

function toMilliseconds(value: unknown): number | undefined {
  const seconds = numberValue(value);
  return seconds === undefined ? undefined : Math.round(seconds * 1000);
}

function optionNumber(input: ProviderInput, key: string, fallback: number): number {
  const value = input.options[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

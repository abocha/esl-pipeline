import { readFile } from 'node:fs/promises';

import { getJobById } from '../domain/job-repository.js';
import { listJobActionHistoryForJob } from '../domain/job-action-history-repository.js';
import { withPgClient } from '../infrastructure/db.js';
import type { VoiceProviderErrorDetails } from '@esl-pipeline/contracts';
import { getPromptPackageLineage, type PromptPackageLineageResponse } from './get-prompt-package.js';
import { parseVoiceProviderError } from './voice-provider-error.js';

interface JobProvenanceRow {
  draft_id: string | null;
  draft_storage_uri: string | null;
  draft_student_id: string | null;
  draft_created_at: Date | null;
  draft_updated_at: Date | null;
  prompt_package_id: string | null;
  prompt_recording_id: string | null;
  prompt_transcript_id: string | null;
  prompt_student_id: string | null;
  prompt_created_at: Date | null;
  prompt_updated_at: Date | null;
  recording_id: string | null;
  recording_student_id: string | null;
  recording_source_path: string | null;
  recording_storage_uri: string | null;
  recording_status: string | null;
  recording_created_at: Date | null;
  transcript_id: string | null;
  transcript_mode: string | null;
  transcript_model: string | null;
  transcript_language: string | null;
  transcript_created_at: Date | null;
}

export interface JobProvenanceResponse {
  job: {
    id: string;
    state: string;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    sourceJobId: string | null;
    manifestPath: string | null;
    notionUrl: string | null;
    anytypeUrl: string | null;
    htmlUrl?: string | null;
    error: string | null;
    providerError?: VoiceProviderErrorDetails | null;
  };
  sourceJob: {
    id: string;
    state: string;
    createdAt: string;
    finishedAt: string | null;
  } | null;
  recording: {
    id: string;
    studentId: string | null;
    sourcePath: string | null;
    storageUri: string | null;
    status: string | null;
    createdAt: string | null;
  } | null;
  transcript: {
    id: string;
    mode: string | null;
    model: string | null;
    language: string | null;
    createdAt: string | null;
  } | null;
  promptPackage: {
    id: string;
    studentId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  } | null;
  draft: {
    id: string;
    studentId: string | null;
    storageUri: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  } | null;
  tts: {
    provider: string | null;
    generatedCharacters: number | null;
    cachedCharacters: number | null;
    totalCharacters: number | null;
    cacheHitRatio: number | null;
    costPer1kCharsUsd: number | null;
    estimatedSpendUsd: number | null;
  } | null;
  lineage: PromptPackageLineageResponse | null;
  actions: {
    id: string;
    actionType: string;
    outcome: 'succeeded' | 'failed';
    requestedAt: string;
    requestedBy: string | null;
    message: string;
    errorCode: string | null;
    createdJobId: string | null;
  }[];
}

export async function getJobProvenance(jobId: string): Promise<JobProvenanceResponse | null> {
  if (!jobId) return null;

  const job = await getJobById(jobId);
  if (!job) return null;

  const [row, sourceJob, actions] = await Promise.all([
    withPgClient(async (client) => {
      const result = await client.query(
        `
        SELECT
          d.id AS draft_id,
          d.storage_uri AS draft_storage_uri,
          d.student_id AS draft_student_id,
          d.created_at AS draft_created_at,
          d.updated_at AS draft_updated_at,
          p.id AS prompt_package_id,
          p.recording_id AS prompt_recording_id,
          p.transcript_id AS prompt_transcript_id,
          p.student_id AS prompt_student_id,
          p.created_at AS prompt_created_at,
          p.updated_at AS prompt_updated_at,
          r.id AS recording_id,
          r.student_id AS recording_student_id,
          r.source_path AS recording_source_path,
          r.storage_uri AS recording_storage_uri,
          r.status AS recording_status,
          r.created_at AS recording_created_at,
          t.id AS transcript_id,
          t.mode AS transcript_mode,
          t.model AS transcript_model,
          t.language AS transcript_language,
          t.created_at AS transcript_created_at
        FROM jobs j
        LEFT JOIN drafts d ON d.id = j.draft_id
        LEFT JOIN prompt_packages p ON p.id = COALESCE(j.prompt_package_id, d.prompt_package_id)
        LEFT JOIN recordings r ON r.id = COALESCE(j.recording_id, p.recording_id)
        LEFT JOIN transcripts t ON t.id = COALESCE(j.transcript_id, p.transcript_id)
        WHERE j.id = $1
        `,
        [jobId],
      );
      return (result.rows[0] as JobProvenanceRow | undefined) ?? null;
    }),
    job.sourceJobId ? getJobById(job.sourceJobId) : Promise.resolve(null),
    listJobActionHistoryForJob(jobId),
  ]);

  const promptPackageId = row?.prompt_package_id ?? null;
  const lineage = promptPackageId ? await getPromptPackageLineage(promptPackageId) : null;
  const tts = await readTtsMetadataFromManifest(job.manifestPath);

  return {
    job: {
      id: job.id,
      state: job.state,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
      sourceJobId: job.sourceJobId ?? null,
      manifestPath: job.manifestPath ?? null,
      notionUrl: job.notionUrl ?? null,
      anytypeUrl: job.anytypeUrl ?? null,
      ...(job.htmlUrl ? { htmlUrl: job.htmlUrl } : {}),
      error: job.error ?? null,
      providerError: parseVoiceProviderError(job.error),
    },
    sourceJob: sourceJob
      ? {
          id: sourceJob.id,
          state: sourceJob.state,
          createdAt: sourceJob.createdAt.toISOString(),
          finishedAt: sourceJob.finishedAt ? sourceJob.finishedAt.toISOString() : null,
        }
      : null,
    recording: row?.recording_id
      ? {
          id: row.recording_id,
          studentId: row.recording_student_id ?? null,
          sourcePath: row.recording_source_path ?? null,
          storageUri: row.recording_storage_uri ?? null,
          status: row.recording_status ?? null,
          createdAt: row.recording_created_at ? row.recording_created_at.toISOString() : null,
        }
      : null,
    transcript: row?.transcript_id
      ? {
          id: row.transcript_id,
          mode: row.transcript_mode ?? null,
          model: row.transcript_model ?? null,
          language: row.transcript_language ?? null,
          createdAt: row.transcript_created_at ? row.transcript_created_at.toISOString() : null,
        }
      : null,
    promptPackage: row?.prompt_package_id
      ? {
          id: row.prompt_package_id,
          studentId: row.prompt_student_id ?? null,
          createdAt: row.prompt_created_at ? row.prompt_created_at.toISOString() : null,
          updatedAt: row.prompt_updated_at ? row.prompt_updated_at.toISOString() : null,
        }
      : null,
    draft: row?.draft_id
      ? {
          id: row.draft_id,
          studentId: row.draft_student_id ?? null,
          storageUri: row.draft_storage_uri ?? null,
          createdAt: row.draft_created_at ? row.draft_created_at.toISOString() : null,
          updatedAt: row.draft_updated_at ? row.draft_updated_at.toISOString() : null,
        }
      : null,
    tts,
    lineage,
    actions: actions.map((event) => ({
      id: event.id,
      actionType: event.actionType,
      outcome: event.outcome,
      requestedAt: event.requestedAt.toISOString(),
      requestedBy: event.requestedBy ?? null,
      message: event.message,
      errorCode: event.errorCode ?? null,
      createdJobId: event.createdJobId ?? null,
    })),
  };
}

async function readTtsMetadataFromManifest(manifestPath: string | null | undefined): Promise<{
  provider: string | null;
  generatedCharacters: number | null;
  cachedCharacters: number | null;
  totalCharacters: number | null;
  cacheHitRatio: number | null;
  costPer1kCharsUsd: number | null;
  estimatedSpendUsd: number | null;
} | null> {
  if (!manifestPath || manifestPath.startsWith('s3://')) {
    return null;
  }

  try {
    const raw = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      audioArtifacts?: {
        studyText?: {
          tts?: {
            provider?: unknown;
            generatedCharacters?: unknown;
            cachedCharacters?: unknown;
            costPer1kCharsUsd?: unknown;
            estimatedSpendUsd?: unknown;
          };
        };
      };
    };
    const tts = parsed.audioArtifacts?.studyText?.tts;
    if (!tts || typeof tts !== 'object') return null;

    const generatedCharacters =
      typeof tts.generatedCharacters === 'number' ? tts.generatedCharacters : null;
    const cachedCharacters = typeof tts.cachedCharacters === 'number' ? tts.cachedCharacters : null;
    const totalCharacters =
      generatedCharacters !== null || cachedCharacters !== null
        ? (generatedCharacters ?? 0) + (cachedCharacters ?? 0)
        : null;
    const cacheHitRatio =
      totalCharacters && totalCharacters > 0 && cachedCharacters !== null
        ? cachedCharacters / totalCharacters
        : null;

    return {
      provider: typeof tts.provider === 'string' ? tts.provider : null,
      generatedCharacters,
      cachedCharacters,
      totalCharacters,
      cacheHitRatio,
      costPer1kCharsUsd: typeof tts.costPer1kCharsUsd === 'number' ? tts.costPer1kCharsUsd : null,
      estimatedSpendUsd: typeof tts.estimatedSpendUsd === 'number' ? tts.estimatedSpendUsd : null,
    };
  } catch {
    return null;
  }
}

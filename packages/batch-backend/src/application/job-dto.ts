// packages/batch-backend/src/application/job-dto.ts
//
// Shared helpers for serializing JobRecord data into the public HTTP/SSE DTO.
import type { JobStatusDto } from '@esl-pipeline/contracts';

import type { JobRecord } from '../domain/job-model.js';
import { parseVoiceProviderError } from './voice-provider-error.js';

export function jobRecordToDto(job: JobRecord): JobStatusDto {
  const providerError = parseVoiceProviderError(job.error);
  return {
    jobId: job.id,
    ...(job.studentId ? { studentId: job.studentId } : {}),
    ...(job.studentName ? { studentName: job.studentName } : {}),
    md: job.md,
    ...(job.mdStorageUri ? { mdStorageUri: job.mdStorageUri } : {}),
    recordingId: job.recordingId ?? null,
    transcriptId: job.transcriptId ?? null,
    promptPackageId: job.promptPackageId ?? null,
    draftId: job.draftId ?? null,
    lessonId: job.lessonId ?? null,
    preset: job.preset ?? null,
    ...(job.learningPresetId ? { learningPresetId: job.learningPresetId } : {}),
    ...(job.learningPresetVersion ? { learningPresetVersion: job.learningPresetVersion } : {}),
    ...(job.promptSnapshotVersion ? { promptSnapshotVersion: job.promptSnapshotVersion } : {}),
    ...(job.promptAlias ? { promptAlias: job.promptAlias } : {}),
    withTts: job.withTts ?? null,
    voiceId: job.voiceId ?? null,
    upload: job.upload ?? null,
    voiceAccent: job.voiceAccent ?? null,
    forceTts: job.forceTts ?? null,
    publishTarget: job.publishTarget ?? null,
    ttsStrategy: job.ttsStrategy ?? null,
    ttsProvider: job.ttsProvider ?? null,
    studyTextElevenlabsModel: job.studyTextElevenlabsModel ?? null,
    googleTtsModel: job.googleTtsModel ?? null,
    htmlUrl: job.htmlUrl ?? null,
    autoPublish: job.autoPublish ?? null,
    state: job.state,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    sourceJobId: job.sourceJobId ?? null,
    error: job.error ?? null,
    providerError,
    manifestPath: job.manifestPath ?? null,
  };
}

export { type JobStatusDto } from '@esl-pipeline/contracts';

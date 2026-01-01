import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { getTranscriptByRecordingId } from '../domain/transcript-repository.js';
import { getRecordingById } from '../domain/recording-repository.js';
import { insertPromptPackage } from '../domain/prompt-package-repository.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { stitchPromptPayload } from './prompt-assembly.js';
import { resolvePromptSelection } from './prompt-options.js';

export interface CreatePromptPackageParams {
  recordingId: string;
  notes?: string | null;
  profilePath?: string | null;
  profileId?: string | null;
  templateId?: string | null;
}

export interface PromptPackageResponse {
  id: string;
  recordingId: string;
  transcriptId: string;
  studentId: string | null;
  profilePath: string | null;
  templateVersion: string;
  notes: string | null;
  storageUri: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromptPackageDependencies {
  config: BatchBackendConfig;
  storage: TranscriptionStorage;
  transcripts: {
    getByRecordingId: typeof getTranscriptByRecordingId;
  };
  recordings: {
    getById: typeof getRecordingById;
  };
  promptPackages: {
    insert: typeof insertPromptPackage;
  };
}

export async function createPromptPackage(
  params: CreatePromptPackageParams,
  overrides?: Partial<CreatePromptPackageDependencies>,
): Promise<PromptPackageResponse | null> {
  if (!params.recordingId) return null;

  const config = overrides?.config ?? loadConfig();
  const storage = overrides?.storage ?? createTranscriptionStorage();
  const transcripts = overrides?.transcripts ?? {
    getByRecordingId: getTranscriptByRecordingId,
  };
  const recordings = overrides?.recordings ?? {
    getById: getRecordingById,
  };
  const promptPackages = overrides?.promptPackages ?? {
    insert: insertPromptPackage,
  };

  const transcript = await transcripts.getByRecordingId(params.recordingId);
  if (!transcript) return null;
  const recording = await recordings.getById(transcript.recordingId);

  const selection = await resolvePromptSelection(
    {
      templateId: params.templateId,
      profileId: params.profileId,
      profilePath: params.profilePath,
    },
    { config },
  );
  const templatePath = selection.templatePath;
  const profilePath = selection.profilePath;
  const [template, profile, transcriptText] = await Promise.all([
    fs.readFile(templatePath, 'utf8'),
    fs.readFile(profilePath, 'utf8'),
    storage.getText(transcript.storageUri),
  ]);

  const payload = stitchPromptPayload({
    template,
    profile,
    transcript: transcriptText,
    notes: params.notes,
  });

  const promptPackageId = randomUUID();
  const stored = await storage.putPromptPackage({
    promptPackageId,
    text: payload,
  });

  const promptPackage = await promptPackages.insert({
    id: promptPackageId,
    recordingId: transcript.recordingId,
    transcriptId: transcript.id,
    studentId: recording?.studentId ?? null,
    profilePath,
    templateVersion: selection.templateId,
    notes: params.notes ?? null,
    storageUri: stored.uri,
  });

  return toPromptPackageResponse(promptPackage, payload);
}

export function toPromptPackageResponse(
  promptPackage: PromptPackageRecord,
  text: string,
): PromptPackageResponse {
  return {
    id: promptPackage.id,
    recordingId: promptPackage.recordingId,
    transcriptId: promptPackage.transcriptId,
    studentId: promptPackage.studentId ?? null,
    profilePath: promptPackage.profilePath ?? null,
    templateVersion: promptPackage.templateVersion,
    notes: promptPackage.notes ?? null,
    storageUri: promptPackage.storageUri,
    text,
    createdAt: promptPackage.createdAt.toISOString(),
    updatedAt: promptPackage.updatedAt.toISOString(),
  };
}

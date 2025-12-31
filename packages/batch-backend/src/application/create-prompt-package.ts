import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { getTranscriptByRecordingId } from '../domain/transcript-repository.js';
import { insertPromptPackage } from '../domain/prompt-package-repository.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { resolveRepoPath, stitchPromptPayload } from './prompt-assembly.js';
import { resolveProfileRoot, resolveUserProfilePath } from './profile-path.js';

export interface CreatePromptPackageParams {
  recordingId: string;
  notes?: string | null;
  profilePath?: string | null;
}

export interface PromptPackageResponse {
  id: string;
  recordingId: string;
  transcriptId: string;
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
  const promptPackages = overrides?.promptPackages ?? {
    insert: insertPromptPackage,
  };

  const transcript = await transcripts.getByRecordingId(params.recordingId);
  if (!transcript) return null;

  const profileRoot = await resolveProfileRoot(config.prompt.defaultProfilePath);
  const templatePath = resolvePromptPath(config.prompt.templatePath);
  const profilePath = params.profilePath
    ? await resolveUserProfilePath(params.profilePath, profileRoot)
    : resolvePromptPath(config.prompt.defaultProfilePath);
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
    profilePath,
    templateVersion: templatePath,
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
    profilePath: promptPackage.profilePath ?? null,
    templateVersion: promptPackage.templateVersion,
    notes: promptPackage.notes ?? null,
    storageUri: promptPackage.storageUri,
    text,
    createdAt: promptPackage.createdAt.toISOString(),
    updatedAt: promptPackage.updatedAt.toISOString(),
  };
}

function resolvePromptPath(inputPath: string): string {
  if (!inputPath) {
    throw new Error('Prompt path is required');
  }
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return resolveRepoPath(inputPath);
}

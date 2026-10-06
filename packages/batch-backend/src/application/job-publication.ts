import { readFile } from 'node:fs/promises';

import type { AssignmentPublicationMetadata } from '@esl-pipeline/contracts';
import type { AssignmentManifest } from '@esl-pipeline/orchestrator';

import type { JobRecord } from '../domain/job-model.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';
import { readAssignmentArtifact } from './assignment-artifact.js';

/** Typed sharing uses frozen domain/manifest metadata, including Slice 2 history. */
export async function getTypedJobPublication(job: JobRecord) {
  if (!job.assignmentArtifact) return null;
  if (!job.promptPackageId) throw new Error('Structured job prompt identity missing');
  const assignment = await readAssignmentArtifact(job.assignmentArtifact, job.promptPackageId);
  let manifest: AssignmentManifest | null = null;
  if (job.manifestPath) {
    try {
      const text = job.manifestPath.startsWith('s3://')
        ? await createTranscriptionStorageForUri(job.manifestPath).getText(job.manifestPath)
        : await readFile(job.manifestPath, 'utf8');
      manifest = JSON.parse(text) as AssignmentManifest;
    } catch {
      // Pending/missing publication has truthful absent audio; never scrape HTML or PMD.
    }
  }
  if (manifest?.assignmentHash && manifest.assignmentHash !== job.assignmentArtifact.contentHash)
    throw new Error('Published assignment identity mismatch');
  const legacy = manifest as (AssignmentManifest & { audio?: { url?: string } }) | null;
  const publication: AssignmentPublicationMetadata = {
    schemaVersion: 1,
    rendererVersion:
      manifest?.publication?.rendererVersion ??
      (job.assignmentRendererVersion === 3 ? 3 : job.assignmentRendererVersion === 2 ? 2 : 1),
    title: assignment.metadata.title,
    icon: '🎧',
    studyTextAudioUrl: manifest?.audioArtifacts?.studyText?.url ?? legacy?.audio?.url ?? null,
    pronunciationAudioUrl: assignment.pronunciation
      ? (manifest?.audioArtifacts?.pronunciation?.primaryClip?.url ??
        manifest?.audioArtifacts?.pronunciationShadowSentence?.url ??
        null)
      : null,
  };
  return { publication, pronunciationMode: assignment.pronunciation?.mode ?? null };
}

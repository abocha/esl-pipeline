import { youtubeVideoId } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { getAssignmentSessionByIdForUser } from '../domain/assignment-session-repository.js';
import { getStudentById } from '../domain/student-repository.js';
import {
  fetchYouTubeMaterialTranscript,
  MaterialTranscriptError,
} from '../infrastructure/material-transcript.js';
import {
  HistoricalAssignmentReadOnlyError,
  isHistoricalAssignmentSession,
} from './historical-assignment.js';
import { resolvePrimaryWorkspaceIdForUser } from './workspace-context.js';

const inFlight = new Map<
  string,
  { videoId: string; promise: Promise<{ sourceUrl: string; sourceText: string }> }
>();

export async function fetchAssignmentMaterialTranscript(
  userId: string,
  sessionId: string,
  sourceUrl: string,
  config: BatchBackendConfig,
): Promise<{ sourceUrl: string; sourceText: string } | null> {
  const session = await getAssignmentSessionByIdForUser(sessionId, userId);
  if (!session) return null;
  const workspaceId = await resolvePrimaryWorkspaceIdForUser(userId);
  if (!(await getStudentById(session.studentId, { workspaceId }))) return null;
  if (await isHistoricalAssignmentSession(session)) throw new HistoricalAssignmentReadOnlyError();
  if (session.confirmedStep === 'share')
    throw new MaterialTranscriptError(
      'assignment_read_only',
      409,
      'Create a new assignment to change material.',
    );
  const videoId = youtubeVideoId(sourceUrl);
  if (!videoId)
    throw new MaterialTranscriptError(
      'unsupported_video_url',
      400,
      'Enter a supported YouTube video link.',
    );
  const key = `${userId}:${sessionId}`;
  const existing = inFlight.get(key);
  if (existing) {
    if (existing.videoId === videoId) return existing.promise;
    throw new MaterialTranscriptError(
      'transcript_in_progress',
      409,
      'A transcript fetch is already in progress.',
    );
  }
  const promise = fetchYouTubeMaterialTranscript(
    sourceUrl,
    config.materialTranscript ?? { timeoutMs: 20_000 },
  );
  inFlight.set(key, { videoId, promise });
  try {
    return await promise;
  } finally {
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
  }
}

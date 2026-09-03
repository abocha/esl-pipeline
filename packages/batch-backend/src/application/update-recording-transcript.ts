import {
  getTranscriptByRecordingIdForWorkspace,
  updateTranscriptWorkingContent,
} from '../domain/transcript-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';
import {
  buildRecordingTranscriptResponse,
  type RecordingTranscriptResponse,
} from './get-recording-transcript.js';

export interface UpdateRecordingTranscriptParams {
  recordingId: string;
  workspaceId: string;
  text: string;
  expectedWorkingVersion: number;
  speakerRoleMapping?: { roles: { speaker: number; role: 'teacher' | 'student' }[] };
}

export interface UpdateRecordingTranscriptDependencies {
  storage: TranscriptionStorage;
  transcripts: {
    getByRecordingId: typeof getTranscriptByRecordingIdForWorkspace;
    update: typeof updateTranscriptWorkingContent;
  };
}

export async function updateRecordingTranscript(
  params: UpdateRecordingTranscriptParams,
  overrides?: Partial<UpdateRecordingTranscriptDependencies>,
): Promise<RecordingTranscriptResponse | null> {
  if (!params.recordingId) return null;

  const storage = overrides?.storage ?? createTranscriptionStorage();
  const transcripts = overrides?.transcripts ?? {
    getByRecordingId: getTranscriptByRecordingIdForWorkspace,
    update: updateTranscriptWorkingContent,
  };

  const transcript = await transcripts.getByRecordingId(params.recordingId, params.workspaceId);
  if (!transcript) return null;

  const mapping = params.speakerRoleMapping;
  const text = mapping ? relabelMixedTranscript(params.text, mapping) : params.text;
  const stored = await storage.putTranscript({
    transcriptId: transcript.id,
    text,
  });
  const summaryJson = mapping
    ? applyTutorConfirmedSpeakerMapping(transcript.summaryJson ?? null, mapping, {
        workingVersion: params.expectedWorkingVersion + 1,
        contentHash: stored.sha256,
      })
    : (transcript.summaryJson ?? null);

  const updated = await transcripts.update({
    id: transcript.id,
    expectedWorkingVersion: params.expectedWorkingVersion,
    storageUri: stored.uri,
    contentHash: stored.sha256,
    ...(mapping ? { summaryJson } : {}),
  });

  if (!updated) return null;

  return buildRecordingTranscriptResponse(updated, text);
}

function applyTutorConfirmedSpeakerMapping(
  summaryJson: Record<string, unknown> | null,
  mapping: NonNullable<UpdateRecordingTranscriptParams['speakerRoleMapping']>,
  binding: { workingVersion: number; contentHash: string },
): Record<string, unknown> {
  if (summaryJson?.audioTopology !== 'mixed_recording') {
    throw new Error('Speaker role mapping is only available for mixed recordings.');
  }
  const speakers = extractObservedSpeakers(summaryJson);
  const roles = mapping.roles;
  if (speakers.length === 0 || roles.length !== speakers.length) {
    throw new Error('Map every observed anonymous speaker before confirming the source.');
  }
  const mapped = new Map(roles.map((item) => [item.speaker, item.role]));
  if (mapped.size !== speakers.length || speakers.some((speaker) => !mapped.has(speaker))) {
    throw new Error('Map every observed anonymous speaker exactly once.');
  }
  if (![...mapped.values()].includes('teacher') || ![...mapped.values()].includes('student')) {
    throw new Error('Map one observed speaker to Teacher and one to Student.');
  }
  const speakerTracks = summaryJson.speakerTracks;
  const relabelTracks =
    speakerTracks && typeof speakerTracks === 'object'
      ? relabelSpeakerTrackMetadata(speakerTracks as Record<string, unknown>, mapped)
      : speakerTracks;
  return {
    ...summaryJson,
    speakerTracks: relabelTracks,
    speakerRoleMapping: {
      version: 'speaker-role-mapping-v1',
      provenance: 'tutor_confirmed',
      confidence: null,
      roles: roles.map((item) => ({ speaker: item.speaker, role: item.role })),
      confirmedWorkingVersion: binding.workingVersion,
      confirmedContentHash: binding.contentHash,
    },
  };
}

function extractObservedSpeakers(summaryJson: Record<string, unknown>): number[] {
  const tracks = summaryJson.speakerTracks;
  if (!tracks || typeof tracks !== 'object') return [];
  const speakers = (tracks as { speakers?: unknown }).speakers;
  if (!Array.isArray(speakers)) return [];
  return speakers
    .map((item) =>
      item &&
      typeof item === 'object' &&
      typeof (item as { speaker?: unknown }).speaker === 'number'
        ? (item as { speaker: number }).speaker
        : null,
    )
    .filter((item): item is number => item !== null);
}

function relabelSpeakerTrackMetadata(
  tracks: Record<string, unknown>,
  mapping: Map<number, 'teacher' | 'student'>,
) {
  const relabel = (value: unknown) =>
    Array.isArray(value)
      ? value.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const speaker = (item as { speaker?: unknown }).speaker;
          const role = typeof speaker === 'number' ? mapping.get(speaker) : undefined;
          return role ? { ...item, label: role === 'teacher' ? 'Teacher' : 'Student' } : item;
        })
      : value;
  return {
    ...tracks,
    speakers: relabel(tracks.speakers),
    transcripts: relabel(tracks.transcripts),
  };
}

function relabelMixedTranscript(
  text: string,
  mapping: NonNullable<UpdateRecordingTranscriptParams['speakerRoleMapping']>,
): string {
  let result = text;
  for (const item of mapping.roles) {
    const label = item.role === 'teacher' ? 'Teacher' : 'Student';
    const speaker = item.speaker + 1;
    result = result
      .replaceAll(`[Speaker ${speaker} `, `[${label} `)
      .replaceAll(`Speaker ${speaker}:`, `${label}:`);
  }
  return result;
}

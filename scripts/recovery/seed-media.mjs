// Executed via stdin inside the pinned backend image, using its actual domain/storage APIs.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';

import { createDraft } from '/app/dist/application/create-draft.js';
import { resolvePrimaryWorkspaceIdForUser } from '/app/dist/application/workspace-context.js';
import { insertPromptPackage } from '/app/dist/domain/prompt-package-repository.js';
import { insertRecording } from '/app/dist/domain/recording-repository.js';
import { insertTranscript } from '/app/dist/domain/transcript-repository.js';
import { FilesystemTranscriptionStorage } from '/app/dist/infrastructure/transcription-storage.js';

const fixture = JSON.parse(readFileSync('/app/uploads/rehearsal-product.json', 'utf8'));
const workspaceId = await resolvePrimaryWorkspaceIdForUser(fixture.userId);
const storage = new FilesystemTranscriptionStorage('/app/uploads');
// Valid one-second mono PCM WAV, generated locally; no external recording or personal data.
const audio = Buffer.alloc(44 + 16000);
audio.write('RIFF');
audio.writeUInt32LE(audio.length - 8, 4);
audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24);
audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write('data', 36);
audio.writeUInt32LE(16000, 40);
const recordingId = randomUUID();
const stored = await storage.putAudio({
  workspaceId,
  recordingId,
  stream: Readable.from(audio),
  extension: 'wav',
});
await insertRecording({
  id: recordingId,
  workspaceId,
  studentId: fixture.studentId,
  source: 'upload',
  storageUri: stored.uri,
  sha256: stored.sha256,
  bytes: stored.bytes,
  durationSec: 1,
  channels: 1,
  status: 'transcribed',
  audioLifecycle: 'retained',
});
const transcriptId = randomUUID();
const transcript = await storage.putTranscript({
  transcriptId,
  text: 'Teacher: This is a synthetic recovery lesson.\nLearner: My persisted work is available again.',
});
await insertTranscript({
  id: transcriptId,
  recordingId,
  storageUri: transcript.uri,
  workingVersion: 1,
  contentHash: transcript.sha256,
  mode: 'timeline',
  model: 'synthetic-no-provider',
  language: 'en',
  sttProvider: 'deepgram',
  fallbackUsed: false,
});
const promptPackageId = randomUUID();
const prompt = await storage.putPromptPackage({
  promptPackageId,
  text: 'Synthetic repository recovery prompt package.',
});
await insertPromptPackage({
  id: promptPackageId,
  recordingId,
  transcriptId,
  studentId: fixture.studentId,
  lessonId: fixture.lessonId,
  templateVersion: 'rehearsal-v1',
  storageUri: prompt.uri,
});
const draftText =
  '# Synthetic recovery draft\n\nMy saved lesson survived the loss of the original host.\n';
const draft = await createDraft(
  { promptPackageId, text: draftText, createdBy: fixture.userId },
  { storage },
);
console.log(
  JSON.stringify({
    workspaceId,
    recordingId,
    transcriptId,
    promptPackageId,
    draftId: draft.id,
    draftText,
    audioHash: stored.sha256,
  }),
);
process.exit(0);

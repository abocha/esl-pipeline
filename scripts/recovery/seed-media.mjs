// Executed via stdin inside the pinned backend image, using its actual domain/storage APIs.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';

import { confirmStudentAssignmentSessionForUser } from '/app/dist/application/assignment-sessions.js';
import { projectCalendarObservation } from '/app/dist/application/calendar-sync.js';
import { createDraft } from '/app/dist/application/create-draft.js';
import { stitchPromptEnvelope } from '/app/dist/application/prompt-assembly.js';
import { updateStudentLesson } from '/app/dist/application/student-schedule-billing.js';
import { resolvePrimaryWorkspaceIdForUser } from '/app/dist/application/workspace-context.js';
import { calendarTransaction } from '/app/dist/domain/calendar-repository.js';
import { insertPromptPackage } from '/app/dist/domain/prompt-package-repository.js';
import { insertRecording } from '/app/dist/domain/recording-repository.js';
import { insertTranscript } from '/app/dist/domain/transcript-repository.js';
import { FilesystemTranscriptionStorage } from '/app/dist/infrastructure/transcription-storage.js';

const fixture = JSON.parse(readFileSync('/app/uploads/rehearsal-product.json', 'utf8'));
const workspaceId = await resolvePrimaryWorkspaceIdForUser(fixture.userId);
// Synthetic calendar authority rows stand in for OAuth. Only the real projection writes lessons;
// no Google request, token or calendar dispatcher is involved (Calendar remains disabled).
const lessonId = await calendarTransaction(async (client) => {
  const grantId = randomUUID();
  const connectionId = randomUUID();
  const bindingId = randomUUID();
  await client.query(
    `INSERT INTO google_oauth_grants(id,workspace_id,authorizing_user_id,issuer,subject,client_id,google_email,granted_scopes,refresh_credential)
     VALUES($1,$2,$3,'https://accounts.google.com',$4,'synthetic-rehearsal','recovery@example.test',$5,'invalid-no-provider')`,
    [
      grantId,
      workspaceId,
      fixture.userId,
      randomUUID(),
      ['https://www.googleapis.com/auth/calendar.events'],
    ],
  );
  await client.query(
    `INSERT INTO workspace_calendar_connections(id,workspace_id,grant_id,calendar_id,calendar_name,calendar_timezone,status,next_sync_at)
     VALUES($1,$2,$3,'synthetic@example.test','Synthetic recovery calendar','Etc/UTC','connected',now()+interval '1 day')`,
    [connectionId, workspaceId, grantId],
  );
  const binding = (
    await client.query(
      `INSERT INTO calendar_schedule_bindings(id,workspace_id,student_id,connection_id,provider_event_id,kind,association_marker,next_projection_at)
     VALUES($1,$2,$3,$4,'synthetic-lesson','one_off',$5,now()+interval '1 day') RETURNING *`,
      [bindingId, workspaceId, fixture.studentId, connectionId, randomUUID()],
    )
  ).rows[0];
  const start = new Date(Date.now() - 86400000);
  await client.query("SELECT set_config('app.calendar_sync','on',true)");
  await projectCalendarObservation(
    client,
    binding,
    {
      id: 'synthetic-lesson',
      summary: 'Synthetic recovery lesson',
      status: 'confirmed',
      start: { dateTime: start.toISOString(), timeZone: 'Etc/UTC' },
      end: { dateTime: new Date(start.getTime() + 3600000).toISOString() },
    },
    new Date(start.getTime() - 3600000),
  );
  return (
    await client.query(
      'SELECT lesson_id FROM calendar_lesson_bindings WHERE schedule_binding_id=$1',
      [bindingId],
    )
  ).rows[0].lesson_id;
});
await updateStudentLesson(
  workspaceId,
  fixture.studentId,
  lessonId,
  {
    status: 'completed',
    notes: 'Persist this lesson across complete host loss.',
  },
  fixture.userId,
);
const session = await confirmStudentAssignmentSessionForUser(fixture.userId, {
  requestId: randomUUID(),
  studentId: fixture.studentId,
  lessonId,
});
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
  lessonId,
  templateVersion: 'rehearsal-v1',
  storageUri: prompt.uri,
  requestEnvelope: stitchPromptEnvelope({
    template: 'Create a synthetic AssignmentV1 homework.',
    canonicalStudentName: 'Synthetic Recovery Learner',
    profile: 'B1',
    studentMemorySnapshot: '',
    recentLessonMemory: '',
    recentHomeworkMemory: '',
    unresolvedIssues: '',
    transcript: 'This is a synthetic recovery lesson.',
    notes: 'Input Type: generate',
  }),
});
const assignment = JSON.parse(readFileSync('/app/uploads/rehearsal-assignment.json', 'utf8'));
assignment.metadata.student = 'Synthetic Recovery Learner';
assignment.metadata.instructionLanguage = 'en';
assignment.metadata.icon = '🧭';
const draft = await createDraft(
  { promptPackageId, text: JSON.stringify(assignment), createdBy: fixture.userId },
  { storage },
);
assert.ok(draft?.id, 'Synthetic structured draft was not created');
// Application logging may write additional stdout lines. The handoff is an explicit file.
writeFileSync(
  '/app/uploads/rehearsal-media.json',
  JSON.stringify({
    workspaceId,
    lessonId,
    sessionId: session.id,
    recordingId,
    transcriptId,
    promptPackageId,
    draftId: draft.id,
    draftText: draft.text,
    audioHash: stored.sha256,
  }),
  { mode: 0o600 },
);
process.exit(0);

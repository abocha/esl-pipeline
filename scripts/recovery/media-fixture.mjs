import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fail before using an incomplete handoff in an authenticated API URL. Never retain draft text
// or arbitrary extra fields in public rehearsal evidence.
export function mediaFixtureEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Media fixture must be an object');
  const evidence = {};
  for (const key of [
    'workspaceId',
    'lessonId',
    'sessionId',
    'recordingId',
    'transcriptId',
    'promptPackageId',
    'draftId',
  ]) {
    if (
      typeof value[key] !== 'string' ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(value[key])
    )
      throw new Error(`Invalid media fixture identifier: ${key}`);
    evidence[key] = value[key];
  }
  if (typeof value.audioHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.audioHash))
    throw new Error('Invalid media fixture audio hash');
  if (typeof value.draftText !== 'string' || !value.draftText.trim())
    throw new Error('Missing media fixture draft');
  const draft = JSON.parse(value.draftText);
  if (draft.schemaVersion !== 1) throw new Error('Expected AssignmentV1 media fixture draft');
  return {
    ...evidence,
    audioHash: value.audioHash,
    draftHash: createHash('sha256').update(value.draftText).digest('hex'),
  };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  console.log(
    JSON.stringify(
      mediaFixtureEvidence(JSON.parse(readFileSync(process.argv[2], 'utf8'))),
      null,
      2,
    ),
  );
}

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mediaFixtureEvidence } from './media-fixture.mjs';

const id = '12345678-1234-4234-8234-123456789abc';
const fixture = () => ({
  workspaceId: id,
  lessonId: id,
  sessionId: id,
  recordingId: id,
  transcriptId: id,
  promptPackageId: id,
  draftId: id,
  audioHash: 'a'.repeat(64),
  draftText: '{"schemaVersion":1,"syntheticText":"private bundle only"}',
});

test('rejects the trailing application-log object that previously became the media handoff', () => {
  assert.throws(
    () => mediaFixtureEvidence({ level: 'info', message: 'Database disconnected' }),
    /identifier: workspaceId/u,
  );
});

for (const field of [
  'workspaceId',
  'lessonId',
  'sessionId',
  'recordingId',
  'transcriptId',
  'promptPackageId',
  'draftId',
  'audioHash',
  'draftText',
]) {
  test(`rejects a missing ${field} before API verification`, () => {
    const value = fixture();
    delete value[field];
    assert.throws(() => mediaFixtureEvidence(value), /media fixture/u);
  });
}

test('retained evidence includes identifiers and hashes without text or extra credentials', () => {
  const value = { ...fixture(), password: 'synthetic-sensitive', accessToken: 'synthetic-token' };
  const evidence = mediaFixtureEvidence(value);
  assert.equal(evidence.recordingId, id);
  assert.equal(evidence.audioHash, 'a'.repeat(64));
  assert.match(evidence.draftHash, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /private bundle|synthetic-sensitive|synthetic-token|draftText/u,
  );
});

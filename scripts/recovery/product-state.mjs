import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const command = process.argv[2];
const base =
  command === 'seed'
    ? 'http://127.0.0.1:18080'
    : command === 'verify-edge'
      ? 'http://recovery.invalid:18081/api'
      : 'http://127.0.0.1:15173/api';
let token;
async function request(route, body) {
  const response = await fetch(`${base}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}: ${JSON.stringify(value)}`);
  return value;
}
async function seed() {
  const email = 'recovery@example.test';
  const password = randomBytes(24).toString('base64url');
  const inviteToken = readFileSync('/tmp/invite.txt', 'utf8').match(/^Token: (\S+)$/mu)?.[1];
  assert.ok(inviteToken);
  const account = await request('/auth/register', { email, password, inviteToken });
  token = account.accessToken;
  const student = await request('/students', {
    student: 'Synthetic Recovery Learner',
    starterProfile: { overallLevel: 'B1', teacherNotes: 'Disposable rehearsal data only.' },
  });
  const fixture = {
    email,
    password,
    userId: account.user.id,
    studentId: student.id,
  };
  writeFileSync('/bundle/product.json', JSON.stringify(fixture, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({
      seeded: true,
      userId: fixture.userId,
      studentId: student.id,
    }),
  );
}
async function verify() {
  const media = JSON.parse(readFileSync('/bundle/media.json', 'utf8'));
  const fixture = { ...JSON.parse(readFileSync('/bundle/product.json', 'utf8')), ...media };
  const login = await request('/auth/login', { email: fixture.email, password: fixture.password });
  assert.equal(login.user.id, fixture.userId);
  token = login.accessToken;
  const students = await request('/students');
  assert.ok(JSON.stringify(students).includes(fixture.studentId));
  const overview = await request(`/students/${fixture.studentId}/surfaces/overview`);
  const schedule = await request(`/students/${fixture.studentId}/surfaces/schedule-billing`);
  assert.ok(JSON.stringify(overview).includes('Synthetic Recovery Learner'));
  const lesson = schedule.lessons.find((row) => row.id === fixture.lessonId);
  assert.equal(lesson?.status, 'completed');
  assert.equal(lesson.notes, 'Persist this lesson across complete host loss.');
  const sessions = await request('/user/assignment-sessions');
  assert.ok(JSON.stringify(sessions).includes(fixture.sessionId));
  const recording = await request(`/recordings/${media.recordingId}`);
  assert.ok(JSON.stringify(recording).includes(fixture.studentId));
  const audio = await fetch(`${base}/recordings/${media.recordingId}/audio`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(audio.status, 200);
  const bytes = Buffer.from(await audio.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), media.audioHash);
  const draft = await request(`/drafts/${media.draftId}`);
  assert.equal(draft.text, media.draftText);
  console.log(
    JSON.stringify(
      {
        ok: true,
        userId: fixture.userId,
        studentId: fixture.studentId,
        lessonId: fixture.lessonId,
        sessionId: fixture.sessionId,
        recordingId: media.recordingId,
        draftId: media.draftId,
        audioHash: media.audioHash,
        authenticatedThroughFrontend: true,
        authenticatedThroughCaddy: command === 'verify-edge',
      },
      null,
      2,
    ),
  );
}
const commands = { seed, verify, 'verify-edge': verify };
if (!Object.hasOwn(commands, command)) throw new Error('Expected seed or verify');
await commands[command]();

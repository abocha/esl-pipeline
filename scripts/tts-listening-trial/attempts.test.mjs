import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceDir = fileURLToPath(new URL('./', import.meta.url));
const secret = 'synthetic-secret-that-must-not-be-logged';
const samples = [
  {
    id: 'dialogue',
    title: 'Synthetic dialogue',
    focus: 'Test input',
    turns: [
      { speaker: 'Alex', text: 'Hello.' },
      { speaker: 'Maya', text: 'Good morning.' },
    ],
  },
  {
    id: 'unselected',
    title: 'Unselected passage',
    focus: 'Test input',
    turns: [{ speaker: 'Alex', text: 'Another passage.' }],
  },
];

function fixture(t, scenario) {
  const root = mkdtempSync(join(tmpdir(), 'tts-attempt-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'scripts', 'tts-listening-trial');
  const out = join(root, 'output');
  mkdirSync(dir, { recursive: true });
  mkdirSync(out);
  for (const name of ['run.mjs', 'report.mjs'])
    copyFileSync(join(sourceDir, name), join(dir, name));
  writeFileSync(join(dir, 'samples.json'), JSON.stringify(samples));
  writeFileSync(join(root, '.env'), `INWORLD_API_KEY=${secret}\n`);
  const sdkDir = join(root, 'packages', 'tts-provider-inworld', 'node_modules', '@inworld', 'tts');
  mkdirSync(sdkDir, { recursive: true });
  writeFileSync(join(root, 'packages', 'tts-provider-inworld', 'package.json'), '{}');
  writeFileSync(join(sdkDir, 'package.json'), JSON.stringify({ main: 'index.cjs' }));
  writeFileSync(
    join(sdkDir, 'index.cjs'),
    `
const fs = require('node:fs');
exports.InworldTTS = () => {
  let count = 0;
  return { async generate() {
    count++;
    fs.appendFileSync(process.env.TTS_TEST_CALLS, 'inworld\\n');
    if (process.env.TTS_TEST_SCENARIO === 'later-turn' && count === 2)
      throw new Error('${secret} raw provider response');
    return Buffer.from('fake mp3');
  } };
};
`,
  );
  const preload = join(root, 'fake-transport.mjs');
  writeFileSync(
    preload,
    `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { writeFileSync, appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const realWriteFileSync = fs.writeFileSync;
fs.writeFileSync = (path, ...args) => {
  if (process.env.TTS_TEST_SCENARIO === 'result-write' && /inworld-tts-2\\.json\\.tmp\\./.test(String(path))) {
    realWriteFileSync(path, '{partial');
    throw new Error('${secret} filesystem failure');
  }
  return realWriteFileSync(path, ...args);
};
childProcess.execFileSync = (name, args) => {
  if (name === 'powershell.exe' || name === 'gcloud') return '${secret}';
  if (name === 'ffprobe') return JSON.stringify({ format: { duration: '2' }, streams: [] });
  if (name !== 'ffmpeg') throw new Error('Unexpected command');
  if (process.env.TTS_TEST_SCENARIO === 'assembly' && args.includes('concat'))
    throw new Error('${secret} raw media failure');
  writeFileSync(args.at(-1), 'fake audio');
  return '';
};
syncBuiltinESMExports();
globalThis.fetch = async () => {
  appendFileSync(process.env.TTS_TEST_CALLS, 'google\\n');
  if (process.env.TTS_TEST_SCENARIO === 'transport') throw new Error('${secret} transport');
  if (process.env.TTS_TEST_SCENARIO === 'http') return {
    status: 403, ok: false, async json() { return { error: { status: '${secret}', message: '${secret} raw payload' } }; },
  };
  return { status: 200, ok: true, async json() { return {
    candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('RIFF1234WAVEfake').toString('base64'), mimeType: 'audio/wav' } }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1 },
  }; } };
};
`,
  );
  const env = { ...process.env, TTS_TEST_SCENARIO: scenario, TTS_TEST_CALLS: join(root, 'calls') };
  return {
    out,
    run(provider = 'inworld') {
      return spawnSync(
        process.execPath,
        [
          '--import',
          pathToFileURL(preload).href,
          join(dir, 'run.mjs'),
          `--provider=${provider}`,
          '--project=fake-project',
          '--sample=dialogue',
          `--out=${out}`,
        ],
        { env, encoding: 'utf8' },
      );
    },
    report() {
      const result = spawnSync(process.execPath, [join(dir, 'report.mjs'), `--out=${out}`], {
        env,
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      return readFileSync(join(out, 'index.html'), 'utf8');
    },
    read(name) {
      return JSON.parse(readFileSync(join(out, name), 'utf8'));
    },
    calls() {
      return readFileSync(join(root, 'calls'), 'utf8').trim().split('\n');
    },
  };
}

test('later-turn failure persists confirmed progress and renders an incomplete attempt', (t) => {
  const f = fixture(t, 'later-turn');
  const run = f.run();
  assert.equal(run.status, 1, run.stderr);
  const failure = f.read('dialogue-inworld-tts-2.failure.json');
  assert.equal(failure.status, 'incomplete');
  assert.equal(failure.completedRequestCount, 1);
  assert.equal(failure.stage, 'provider_request');
  assert.equal(failure.requestOutcome, 'unknown');
  assert.deepEqual(f.calls(), ['inworld', 'inworld']);
  assert.ok(existsSync(join(f.out, 'dialogue-inworld-tts-2-turn-0.mp3')));
  assert.ok(!existsSync(join(f.out, 'dialogue-inworld-tts-2.json')));
  assert.ok(!`${run.stdout}${run.stderr}${JSON.stringify(failure)}`.includes(secret));
  const html = f.report();
  assert.match(html, /Incomplete attempt/);
  assert.match(html, /1 confirmed successful provider requests/);
  assert.match(html, /Not generated yet/);
  assert.deepEqual(f.read('results.json'), []);
});

test('Google HTTP failure suppresses raw error code, message and bearer token', (t) => {
  const f = fixture(t, 'http');
  const run = f.run('google');
  assert.equal(run.status, 1, run.stderr);
  const failure = f.read('dialogue-gemini-3.8-flash-tts.failure.json');
  assert.equal(failure.status, 'failed');
  assert.equal(failure.completedRequestCount, 0);
  assert.equal(failure.stage, 'provider_response');
  assert.equal(failure.requestOutcome, 'confirmed_failure');
  assert.equal(failure.httpStatus, 403);
  assert.match(failure.errorSummary, /Google HTTP 403/);
  assert.deepEqual(f.calls(), ['google']);
  const html = f.report();
  assert.match(html, /Failed attempt/);
  assert.ok(!`${run.stdout}${run.stderr}${JSON.stringify(failure)}${html}`.includes(secret));
});

test('transport failure records unknown dispatch outcome without inventing completion', (t) => {
  const f = fixture(t, 'transport');
  const run = f.run('google');
  assert.equal(run.status, 1, run.stderr);
  const failure = f.read('dialogue-gemini-3.8-flash-tts.failure.json');
  assert.equal(failure.completedRequestCount, 0);
  assert.equal(failure.requestOutcome, 'unknown');
  assert.equal(failure.stage, 'provider_request');
  assert.ok(!`${run.stderr}${JSON.stringify(failure)}`.includes(secret));
  assert.deepEqual(f.calls(), ['google']);
});

test('assembly failure retains completed provider count and sanitized stage', (t) => {
  const f = fixture(t, 'assembly');
  const run = f.run();
  assert.equal(run.status, 1, run.stderr);
  const failure = f.read('dialogue-inworld-tts-2.failure.json');
  assert.equal(failure.status, 'incomplete');
  assert.equal(failure.completedRequestCount, 2);
  assert.equal(failure.requestOutcome, 'confirmed_success');
  assert.equal(failure.stage, 'assemble_audio');
  assert.ok(!`${run.stderr}${JSON.stringify(failure)}`.includes(secret));
});

test('successful records, skip behavior and completed-only report results remain compatible', (t) => {
  const f = fixture(t, 'success');
  const run = f.run();
  assert.equal(run.status, 0, run.stderr);
  const metadata = f.read('dialogue-inworld-tts-2.json');
  assert.equal(metadata.requestCount, 2);
  assert.equal(metadata.status, undefined);
  assert.equal(metadata.completedRequestCount, undefined);
  assert.ok(!existsSync(join(f.out, 'dialogue-inworld-tts-2.failure.json')));
  const rerun = f.run();
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(rerun.stdout, /already generated; preserved \(no new charge\)/);
  assert.deepEqual(f.calls(), ['inworld', 'inworld']);
  const html = f.report();
  assert.match(html, /<audio controls/);
  assert.match(html, /Not generated yet/);
  assert.doesNotMatch(html, /Incomplete attempt|Failed attempt/);
  assert.deepEqual(f.read('results.json'), [metadata]);
});

test('result publication failure leaves incomplete evidence instead of a partial success record', (t) => {
  const f = fixture(t, 'result-write');
  const run = f.run();
  assert.equal(run.status, 1, run.stderr);
  const failure = f.read('dialogue-inworld-tts-2.failure.json');
  assert.equal(failure.completedRequestCount, 2);
  assert.equal(failure.stage, 'write_result');
  assert.ok(!existsSync(join(f.out, 'dialogue-inworld-tts-2.json')));
  assert.match(f.report(), /Incomplete attempt/);
  assert.deepEqual(f.read('results.json'), []);
});

test('legacy Google failures remain visible without rendering their raw provider payload', (t) => {
  const f = fixture(t, 'unused');
  writeFileSync(
    join(f.out, 'dialogue-gemini-3.8-flash-tts.failure.json'),
    JSON.stringify({
      status: 403,
      code: secret,
      message: secret,
    }),
  );
  const html = f.report();
  assert.match(html, /Failed attempt/);
  assert.match(html, /unknown confirmed successful provider requests/);
  assert.ok(!html.includes(secret));
  assert.deepEqual(f.read('results.json'), []);
});

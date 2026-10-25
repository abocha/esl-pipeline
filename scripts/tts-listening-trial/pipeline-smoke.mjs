// Explicitly invoked synthetic live-provider evidence. Uploads stay on loopback.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.argv.find((arg) => arg.startsWith('--project='))?.slice(10);
if (!project || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) {
  throw new Error(
    'Pass --project=PROJECT_ID. This makes small billable Gemini TTS calls using ADC.',
  );
}
const output = join(
  root,
  'tmp/gemini-pipeline-smoke',
  new Date().toISOString().replaceAll(/[:.]/g, '-'),
);
mkdirSync(output, { recursive: true });
mkdirSync(join(output, 'objects'), { recursive: true });
const baseUrl = 'http://127.0.0.1:8795';
const localizeHtml = (html) =>
  html
    .replaceAll(
      'https://esl-gemini-smoke.s3.us-east-1.amazonaws.com/',
      `${baseUrl}/esl-gemini-smoke/`,
    )
    .replaceAll('https://esl-gemini-smoke.s3.amazonaws.com/', `${baseUrl}/esl-gemini-smoke/`);
// Standard AWS SDK service endpoint env redirects every canonical publisher/uploader request.
// Fixed dummy AWS credentials and isolated cwd prevent production credential/config discovery.
for (const name of ['AWS_PROFILE', 'AWS_SESSION_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS'])
  delete process.env[name];
Object.assign(process.env, {
  PIPELINE_CWD: output,
  AWS_ENDPOINT_URL_S3: baseUrl,
  AWS_ENDPOINT_URL: baseUrl,
  AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'false',
  AWS_ACCESS_KEY_ID: 'local-smoke',
  AWS_SECRET_ACCESS_KEY: 'local-smoke-only',
  AWS_REGION: 'us-east-1',
  AWS_EC2_METADATA_DISABLED: 'true',
  AWS_REQUEST_CHECKSUM_CALCULATION: 'WHEN_REQUIRED',
  S3_BUCKET: 'esl-gemini-smoke',
  ESL_TTS_PROVIDER_GEMINI_PROJECT_ID: project,
  ESL_TTS_DEFAULT_PROVIDER: 'gemini',
  BATCH_TTS_CACHE_DIR: join(output, 'cache'),
});

const objects = new Map();
const server = createServer(async (request, response) => {
  try {
    const key = new URL(request.url, baseUrl).pathname;
    if (request.method === 'PUT') {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 20 * 1024 * 1024) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const type = request.headers['content-type'] ?? 'application/octet-stream';
      const etag = `"${createHash('md5').update(body).digest('hex')}"`;
      objects.set(key, { body, type, etag, sha256: request.headers['x-amz-meta-sha256'] });
      writeFileSync(join(output, 'objects', createHash('sha256').update(key).digest('hex')), body);
      response.writeHead(200, { ETag: etag }).end();
      return;
    }
    const handout =
      key === '/' ? 'handout.html' : key === '/monologue.html' ? 'monologue.html' : undefined;
    if (handout && existsSync(join(output, handout))) {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      createReadStream(join(output, handout)).pipe(response);
      return;
    }
    const object = objects.get(key);
    if (!object) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': object.type,
      'Content-Length': object.body.length,
      ETag: object.etag,
      ...(object.sha256 ? { 'x-amz-meta-sha256': object.sha256 } : {}),
    });
    response.end(request.method === 'HEAD' ? undefined : object.body);
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(8795, '127.0.0.1', resolve);
});

try {
  const { newAssignment } = await import('../../packages/orchestrator/dist/index.js');
  const assignment = JSON.parse(
    readFileSync(join(root, 'packages/contracts/tests/assignment-fixture.json'), 'utf8'),
  );
  const events = [];
  const logger = {
    log(event) {
      events.push(event);
    },
  };
  const neverPlan = {
    plan: async () => {
      throw new Error('Gemini must not call the speech planner');
    },
  };
  const neverRank = {
    metadata: { provider: 'openai', model: 'unused', generatedAt: new Date().toISOString() },
    rank: async () => {
      throw new Error('Gemini must not call the voice ranker');
    },
  };
  const voices = join(output, 'voices.yml');
  writeFileSync(voices, 'auto: true\n');
  const results = [];
  for (const name of ['first', 'cached', 'monologue']) {
    const dir = join(output, name);
    mkdirSync(dir, { recursive: true });
    const md = join(dir, 'assignment.json');
    const currentAssignment = structuredClone(assignment);
    if (name === 'monologue') {
      const study = currentAssignment.input.studyText;
      study.type = 'monologue';
      study.speakers = [study.speakers[0]];
      study.turns = [
        { speakerId: study.speakers[0].id, text: study.turns.map((turn) => turn.text).join(' ') },
      ];
      currentAssignment.pronunciation = null;
    }
    const result = await newAssignment(
      {
        md,
        assignment: currentAssignment,
        out: dir,
        voices,
        withTts: true,
        // Exercise configured defaults rather than explicit provider/model overrides.
        upload: 's3',
      },
      {},
      { logger, speechPlanner: neverPlan, voiceRanker: neverRank },
    );
    results.push(result);
    const calls = events.filter(
      (event) => event.message === 'Gemini Cloud TTS synthesis completed',
    ).length;
    console.log(`${name}: cumulative Gemini synthesis calls ${calls}`);
    if (name === 'first') results[0].synthesisCalls = calls;
    if (name === 'cached' && calls !== results[0].synthesisCalls)
      throw new Error('Identical pipeline rerun made additional synthesis calls.');
    if (name === 'monologue') {
      const objectKey = `/esl-gemini-smoke${new URL(result.htmlUrl).pathname}`;
      const monoHtml = objects.get(objectKey);
      if (!monoHtml) throw new Error('Monologue HTML did not reach local publication.');
      writeFileSync(join(output, 'monologue.html'), localizeHtml(monoHtml.body.toString('utf8')));
    }
  }
  const htmlObject = [...objects.entries()].find(([key]) => key.endsWith('.html'));
  if (!htmlObject) throw new Error('Canonical HTML publication did not reach the local sink.');
  const html = localizeHtml(htmlObject[1].body.toString('utf8'));
  writeFileSync(join(output, 'handout.html'), html);
  const manifest = JSON.parse(readFileSync(join(output, 'first/assignment.manifest.json'), 'utf8'));
  if (
    manifest.speechPlans?.studyText?.mode !== 'identity' ||
    manifest.voicePlans?.studyText?.mode !== 'deterministic'
  )
    throw new Error('Unexpected planning mode.');
  const report = {
    project,
    output,
    htmlUrl: `${baseUrl}/`,
    synthesisCalls: results[0].synthesisCalls,
    monologueSynthesisCalls:
      events.filter((event) => event.message === 'Gemini Cloud TTS synthesis completed').length -
      results[0].synthesisCalls,
    cacheReuseCalls: 0,
    localObjects: objects.size,
    manifestSchemaVersion: manifest.schemaVersion,
    speechPlanMode: manifest.speechPlans?.studyText?.mode,
    voicePlanMode: manifest.voicePlans?.studyText?.mode,
    providerEvents: events
      .filter((event) => event.message?.startsWith('Gemini'))
      .map((event) => ({ message: event.message, detail: event.detail })),
  };
  writeFileSync(join(output, 'evidence.json'), JSON.stringify(report, null, 2));
  writeFileSync(
    join(output, 'object-index.json'),
    JSON.stringify(
      [...objects.entries()].map(([key, object]) => ({
        key,
        type: object.type,
        file: createHash('sha256').update(key).digest('hex'),
      })),
      null,
      2,
    ),
  );
  console.log(`Integrated handout: ${baseUrl}/`);
  console.log(`Evidence: ${join(output, 'evidence.json')}`);
  if (!process.argv.includes('--serve')) server.close();
} catch (error) {
  server.close();
  throw error;
}

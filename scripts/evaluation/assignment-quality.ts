import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildOpenAiResponsesRequestBody,
  parseOpenAiAssignmentResponsesPayload,
  parseOpenAiResponsesPayload,
} from '../../packages/batch-backend/src/application/openai-responses-contract.js';
import { stitchPromptEnvelope } from '../../packages/batch-backend/src/application/prompt-assembly.js';
import { serializeAssignmentV1 } from '../../packages/contracts/src/assignment-artifact.js';
import {
  ASSIGNMENT_RESPONSE_SCHEMA,
  ASSIGNMENT_TEMPLATE_ID,
  validateFreshAssignmentV1,
} from '../../packages/contracts/src/assignment-v1.js';
import { PROMPT_SCHEMA_VERSION } from '../../packages/contracts/src/contract-versions.js';
import { renderAssignmentToHtml } from '../../packages/html-publisher/src/assignment-adapter.js';

// One bounded ESL-28 experiment, deliberately separate from the general generation evaluator.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.join(repo, '.tmp/esl-28');
const ids = ['beginner-support', 'everyday-contrast', 'technical-transfer'] as const;
const model = 'gpt-6.1-sol';
const maxOutputTokens = 12_000;
const timeoutMs = 240_000;
const templatePath = 'packages/batch-backend/prompt-assets/templates/hw_prompt_assignment_v1.md';
const rubric = [
  'instruction/support-language correctness',
  'separation of support language from target English',
  'learner scaffolding adequacy',
  'grammar usefulness and meaningful contrasts',
  'vocabulary/chunk usefulness',
  'controlled-practice progression',
  'pronunciation relevance and restraint',
  'mission scanability',
  'actionable self-checks',
  'learner rationale quality',
  'teacher rationale audience separation',
  'answer leakage',
  'unnecessary repetition/filler',
  'direct-send usability',
];
type CaseId = (typeof ids)[number];
type Envelope = ReturnType<typeof stitchPromptEnvelope>;
interface CaseLock {
  id: CaseId;
  files: Record<string, string>;
}
interface Lock {
  version: 'esl-28-v1';
  sourceCommit: string;
  codeFiles: Record<string, string>;
  cases: CaseLock[];
  template: { id: string; path: string; sha256: string; normalizedSha256: string };
  schema: { name: string; sha256: string };
  promptCompatibilityVersion: string;
  provider: { endpoint: string; model: string; timeoutMs: number; retries: number };
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const writeJson = (file: string, value: unknown) =>
  writeFileSync(file, json(value), { flag: 'wx' });
const caseDir = (id: CaseId) => path.join(root, 'cases', id);
const schemaHash = () => hash(JSON.stringify(ASSIGNMENT_RESPONSE_SCHEMA));

function filesUnder(relative: string): string[] {
  return readdirSync(path.join(repo, relative), { withFileTypes: true }).flatMap((entry) => {
    const name = `${relative}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(name) : [name];
  });
}

function codeIdentity(): Record<string, string> {
  const files = [
    'scripts/evaluation/assignment-quality.ts',
    'pnpm-lock.yaml',
    'package.json',
    'packages/batch-backend/src/application/prompt-assembly.ts',
    'packages/batch-backend/src/application/generation-request-envelope.ts',
    'packages/batch-backend/src/application/openai-responses-contract.ts',
    'packages/html-publisher/src/assignment-adapter.ts',
    templatePath,
    ...filesUnder('packages/contracts/src'),
    ...filesUnder('packages/learner-handout/src'),
    ...filesUnder('packages/learner-handout/dist'),
    ...filesUnder('packages/html-publisher/node_modules/@esl-pipeline/learner-handout/dist'),
  ];
  return Object.fromEntries(
    files.sort().map((file) => [file, hash(readFileSync(path.join(repo, file)))]),
  );
}

function assessmentTemplate(id: string): string {
  return (
    `# ${id} — PENDING actual generation review\n\n` +
    'Inspect raw JSON and emitted learner.html at desktop and mobile widths. Open the answer disclosure separately.\n\n' +
    '| Criterion | PASS / REPAIR / N/A | Artifact location and concise evidence |\n|---|---|---|\n' +
    rubric.map((criterion) => `| ${criterion} | PENDING | |`).join('\n') +
    '\n\nDirect-send verdict: PENDING (YES / NO / UNASSESSABLE). No numeric average overrides this judgment.\n\n' +
    'Concrete defects: location, learner consequence, smallest necessary repair, severity (blocking / minor), and classification.\n\n' +
    'Classifications: prompt/policy; model variance (suspected, not established by one sample); missing context; schema/contract limitation; renderer; legitimate pedagogical variation.\n\n' +
    'Pronunciation: explain inclusion OR omission from supplied evidence; no acoustic diagnosis from transcript.\n\n' +
    'Additional evidence: name the specific decision another case/call could change before requesting it.\n'
  );
}

function requestFor(envelope: Envelope): Record<string, unknown> {
  return buildOpenAiResponsesRequestBody({
    model,
    envelope,
    responseSchema: ASSIGNMENT_RESPONSE_SCHEMA,
    maxOutputTokens,
    store: true,
  });
}

function prepare(sourceIndexPath: string): void {
  assert(!existsSync(root), 'The frozen evaluation already exists; do not overwrite it.');
  const index =
    readJson<Record<CaseId, { response: string; inputItems: string; reason: string }>>(
      sourceIndexPath,
    );
  assert.deepEqual(Object.keys(index).sort(), [...ids].sort());
  const templateBytes = readFileSync(path.join(repo, templatePath));
  const template = templateBytes.toString('utf8').replaceAll('\r\n', '\n').trim();
  assert.equal(
    template.split('\n')[0],
    `Assignment output contract: ${ASSIGNMENT_RESPONSE_SCHEMA.name}`,
  );
  assert.equal(ASSIGNMENT_RESPONSE_SCHEMA.name, 'assignment_v1_generation_v5');
  const codeFiles = codeIdentity();
  // Validate every input before creating the immutable experiment directory.
  const prepared = ids.map((id) => {
    const source = index[id];
    const response = readJson<{ id: string; model: string; created_at: number }>(source.response);
    assert(['gpt-5.6-sol', 'gpt-6.1-sol'].includes(response.model));
    const items = readJson<Array<{ role: string; content: Array<{ type: string; text: string }> }>>(
      source.inputItems,
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]?.role, 'user');
    assert.equal(items[0]?.content.length, 1);
    assert.equal(items[0]?.content[0]?.type, 'input_text');
    const input = items[0]?.content[0]?.text;
    assert(input);
    const matches = [
      ...input.matchAll(/<source_data id="[^"]+" label="([^"]+)">\n([\s\S]*?)\n<\/source_data>/g),
    ];
    const blocks = Object.fromEntries(matches.map((match) => [match[1], match[2]]));
    assert.equal(matches.length, 8);
    assert.equal(Object.keys(blocks).length, 8);
    const envelope = stitchPromptEnvelope({
      template,
      canonicalStudentName: blocks.CANONICAL_STUDENT_NAME,
      profile: blocks.FOUNDATIONAL_PROFILE ?? '',
      studentMemorySnapshot: blocks.STUDENT_MEMORY_SNAPSHOT ?? '',
      recentLessonMemory: blocks.RECENT_LESSON_MEMORY ?? '',
      recentHomeworkMemory: blocks.RECENT_HOMEWORK_MEMORY ?? '',
      unresolvedIssues: blocks.UNRESOLVED_ISSUES ?? '',
      notes: blocks.TEACHER_NOTES,
      transcript: blocks.LATEST_TRANSCRIPT ?? '',
    });
    assert.equal(
      envelope.input,
      input,
      'Current production assembly must reproduce preserved source input exactly.',
    );
    return { id, source, response, input, blocks, envelope, items };
  });
  mkdirSync(path.join(root, 'cases'), { recursive: true });
  writeFileSync(path.join(root, 'template.md'), templateBytes, { flag: 'wx' });
  writeJson(path.join(root, 'response-schema.json'), ASSIGNMENT_RESPONSE_SCHEMA);
  const cases = prepared.map(({ id, source, response, input, blocks, envelope, items }) => {
    const dir = caseDir(id);
    mkdirSync(dir);
    writeJson(path.join(dir, 'sources.json'), blocks);
    writeJson(path.join(dir, 'input-items.json'), items);
    writeFileSync(path.join(dir, 'input.txt'), input, { flag: 'wx' });
    writeJson(path.join(dir, 'envelope.json'), envelope);
    writeJson(path.join(dir, 'context.json'), envelope.assignmentContext);
    writeJson(path.join(dir, 'request.json'), requestFor(envelope));
    writeJson(path.join(dir, 'provenance.json'), {
      responseId: response.id,
      sourceModel: response.model,
      sourceCreatedAt: response.created_at,
      responseFileSha256: hash(readFileSync(source.response)),
      inputItemsFileSha256: hash(readFileSync(source.inputItems)),
      reason: source.reason,
      originalFiles: source,
      sourceDataPolicy:
        'Exact preserved real sources; no current DB reconstruction or tutor-note edits.',
    });
    writeFileSync(path.join(dir, 'assessment.md'), assessmentTemplate(id), { flag: 'wx' });
    return {
      id,
      files: Object.fromEntries(
        readdirSync(dir)
          .filter((file) => file !== 'assessment.md')
          .map((file) => [file, hash(readFileSync(path.join(dir, file)))]),
      ),
    };
  });
  const lock: Lock = {
    version: 'esl-28-v1',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim(),
    codeFiles,
    cases,
    template: {
      id: ASSIGNMENT_TEMPLATE_ID,
      path: templatePath,
      sha256: hash(templateBytes),
      normalizedSha256: hash(template),
    },
    schema: { name: ASSIGNMENT_RESPONSE_SCHEMA.name, sha256: schemaHash() },
    promptCompatibilityVersion: PROMPT_SCHEMA_VERSION,
    provider: { endpoint: 'https://api.openai.com/v1/responses', model, timeoutMs, retries: 0 },
  };
  writeJson(path.join(root, 'lock.json'), lock);
  writeFileSync(path.join(root, 'lock.sha256'), hash(json(lock)), { flag: 'wx' });
  writeFileSync(
    path.join(root, 'decision.md'),
    '# ESL-28 activation decision — PENDING\n\n' +
      'No paid generation or quality assessment yet. Final KEEP / CHANGE / DEFER must cite all three case verdicts and concrete artifact locations.\n',
    { flag: 'wx' },
  );
  console.log(
    json({ prepared: ids, root, schema: lock.schema, template: lock.template, providerCalls: 0 }),
  );
}

function verify(): Lock {
  const lock = readJson<Lock>(path.join(root, 'lock.json'));
  assert.equal(
    hash(readFileSync(path.join(root, 'lock.json'))),
    readFileSync(path.join(root, 'lock.sha256'), 'utf8'),
  );
  assert.equal(lock.version, 'esl-28-v1');
  assert.deepEqual(
    lock.cases.map((entry) => entry.id),
    ids,
  );
  assert.deepEqual(lock.codeFiles, codeIdentity(), 'Code/build drift; do not silently re-freeze.');
  assert.equal(lock.schema.sha256, schemaHash());
  assert.equal(lock.promptCompatibilityVersion, PROMPT_SCHEMA_VERSION);
  assert.equal(lock.template.id, ASSIGNMENT_TEMPLATE_ID);
  assert.equal(
    hash(readFileSync(path.join(root, 'response-schema.json'))),
    hash(json(ASSIGNMENT_RESPONSE_SCHEMA)),
  );
  assert.equal(hash(readFileSync(path.join(root, 'template.md'))), lock.template.sha256);
  assert.deepEqual(lock.provider, {
    endpoint: 'https://api.openai.com/v1/responses',
    model,
    timeoutMs,
    retries: 0,
  });
  for (const entry of lock.cases) {
    for (const [file, sha] of Object.entries(entry.files)) {
      assert.equal(
        hash(readFileSync(path.join(caseDir(entry.id), file))),
        sha,
        `${entry.id}/${file} drift`,
      );
    }
    const envelope = readJson<Envelope>(path.join(caseDir(entry.id), 'envelope.json'));
    assert.deepEqual(readJson(path.join(caseDir(entry.id), 'request.json')), requestFor(envelope));
    assert.deepEqual(envelope.settings, { reasoningEffort: 'medium', textVerbosity: 'medium' });
  }
  return lock;
}

async function capture(
  dir: string,
  payload: unknown,
  context: Envelope['assignmentContext'],
): Promise<boolean> {
  const parsed = parseOpenAiAssignmentResponsesPayload(payload);
  // Preserve partial output too, even when completed-message admission rejects it.
  let raw = parsed.rawText;
  if (!raw) {
    try {
      raw = parseOpenAiResponsesPayload(payload).text;
    } catch {
      /* No output text. */
    }
  }
  writeFileSync(path.join(dir, 'output.raw.txt'), raw);
  let admitted = false;
  try {
    if (parsed.contractError) throw new Error(parsed.contractError);
    const assignment = validateFreshAssignmentV1(JSON.parse(raw), context);
    admitted = true;
    writeFileSync(path.join(dir, 'assignment.json'), json(assignment));
    const html = await renderAssignmentToHtml(assignment);
    writeFileSync(path.join(dir, 'learner.html'), html);
    writeFileSync(
      path.join(dir, 'validation.json'),
      json({
        admitted: true,
        rendered: true,
        schema: ASSIGNMENT_RESPONSE_SCHEMA.name,
        rendererVersion: 3,
        htmlSha256: hash(html),
        assignmentSha256: hash(serializeAssignmentV1(assignment)),
        media: 'Unavailable; no TTS, audio, upload or publication calls.',
      }),
    );
    return true;
  } catch (error) {
    writeFileSync(
      path.join(dir, 'validation.json'),
      json({
        admitted,
        rendered: false,
        stage: admitted ? 'renderer' : 'admission',
        error: error instanceof Error ? error.message : String(error),
        learnerArtifact: 'Unavailable: fresh admission/rendering failed; no repair or conversion.',
      }),
    );
    return false;
  }
}

async function smoke(): Promise<void> {
  verify();
  const dir = path.join(root, 'plumbing-only');
  mkdirSync(dir, { recursive: true });
  const fixture = readJson<Record<string, unknown>>(
    path.join(repo, 'packages/contracts/tests/assignment-grammar-fixture.json'),
  );
  Object.assign(fixture.metadata as object, { instructionLanguage: 'ru' });
  const sentinel = 'TEACHER_ONLY_ESL28_SENTINEL';
  fixture.teacherRationale = sentinel;
  const payload = {
    id: 'fixture-only-not-a-provider-response',
    model,
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(fixture) }],
      },
    ],
  };
  writeFileSync(path.join(dir, 'response.json'), json(payload));
  assert(await capture(dir, payload, undefined));
  const html = readFileSync(path.join(dir, 'learner.html'), 'utf8');
  assert(!html.includes(sentinel));
  assert(html.startsWith('<!doctype html>'));
  assert(html.includes('<html lang="ru">'));
  assert(html.includes('lang="en"'));
  const rejected = path.join(dir, 'incomplete');
  mkdirSync(rejected, { recursive: true });
  assert.equal(await capture(rejected, { ...payload, status: 'incomplete' }, undefined), false);
  assert(!existsSync(path.join(rejected, 'learner.html')));
  assert(readFileSync(path.join(rejected, 'output.raw.txt'), 'utf8').length > 0);
  await assert.rejects(run(ids[0], []), /Paid calls require/);
  assert.throws(
    () => checkPriorAttempts(ids[0], () => ({ state: 'dispatched' })),
    /Already attempted/,
  );
  assert.throws(
    () => checkPriorAttempts(ids[0], (id) => (id === ids[1] ? { state: 'dispatched' } : null)),
    /Uncertain previous/,
  );
  assert.throws(
    () => checkPriorAttempts(ids[0], (id) => (id === ids[1] ? { state: 'captured' } : null)),
    /Unknown prior usage/,
  );
  writeFileSync(
    path.join(dir, 'checks.json'),
    json({
      providerCalls: 0,
      purpose: 'Artifact plumbing only; not generated learner-quality evidence.',
      checks: [
        'fresh admission',
        'native HTML',
        'teacher rationale excluded',
        'incomplete response rejected with raw text retained',
        'support and target HTML language annotations',
        'missing authorization, duplicate dispatch, uncertain dispatch and unknown usage refused',
      ],
    }),
  );
  console.log('Offline plumbing passed. Zero provider calls; quality verdict remains PENDING.');
}

function checkPriorAttempts(
  id: CaseId,
  read: (id: CaseId) => { state: string; totalTokens?: number } | null,
): void {
  assert.equal(read(id), null, 'Already attempted; no paid retry.');
  const prior = ids
    .filter((other) => other !== id)
    .map(read)
    .filter((entry) => entry !== null);
  assert(
    prior.every((entry) => entry.state === 'captured'),
    'Uncertain previous dispatch; stop.',
  );
  assert(
    prior.every((entry) => Number.isInteger(entry.totalTokens)),
    'Unknown prior usage; stop.',
  );
}

async function run(id: CaseId, flags: string[]): Promise<void> {
  assert(
    flags.includes('--live') && flags.includes('--authorize=ESL-28'),
    'Paid calls require --live --authorize=ESL-28 and explicit human authorization in the chat.',
  );
  const lock = verify();
  assert(ids.includes(id), 'Only the three frozen cases are allowed.');
  // One attempt file per case is the ledger. Unknown prior usage blocks subsequent calls.
  checkPriorAttempts(id, (prior) => {
    const attemptPath = path.join(caseDir(prior), 'attempt.json');
    return existsSync(attemptPath) ? readJson(attemptPath) : null;
  });
  // Deliberately no ambient model/settings/base-URL reads. Only the authorized key is loaded.
  const env = readFileSync(path.join(repo, '.env'), 'utf8');
  const { parseEnv } = await import('node:util');
  const apiKey = parseEnv(env).OPENAI_API_KEY?.trim();
  assert(apiKey, 'OPENAI_API_KEY unavailable in repository .env.');
  const dir = caseDir(id);
  const attemptPath = path.join(dir, 'attempt.json');
  const requestText = readFileSync(path.join(dir, 'request.json'), 'utf8');
  const startedAt = new Date().toISOString();
  // Exclusive creation precedes dispatch, preventing accidental concurrent/duplicate calls.
  writeJson(attemptPath, { state: 'dispatched', startedAt, requestSha256: hash(requestText) });
  try {
    const response = await fetch(lock.provider.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: requestText,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    writeFileSync(path.join(dir, 'response.raw.json'), body, { flag: 'wx' });
    writeJson(path.join(dir, 'transport.json'), {
      status: response.status,
      requestId: response.headers.get('x-request-id'),
      responseSha256: hash(body),
      completedAt: new Date().toISOString(),
    });
    assert(response.ok, `Provider HTTP ${response.status}; raw response retained, no retry.`);
    const payload = JSON.parse(body);
    writeJson(path.join(dir, 'response.json'), payload);
    const parsed = parseOpenAiAssignmentResponsesPayload(payload);
    writeJson(path.join(dir, 'usage.json'), {
      responseId: parsed.providerRequestId,
      returnedModel: parsed.model,
      usage: payload.usage ?? null,
      finishReason: parsed.finishReason,
    });
    const artifactsReady = await capture(dir, payload, readJson(path.join(dir, 'context.json')));
    assert(
      Number.isInteger(parsed.usage?.totalTokens),
      'Usage unavailable; stop before any further call.',
    );
    const usage = parsed.usage;
    assert(
      usage && typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number',
    );
    assert.equal(usage.inputTokens + usage.outputTokens, usage.totalTokens);
    assert.equal(
      parsed.model,
      model,
      'Returned model changed; stop and classify before further calls.',
    );
    writeFileSync(
      attemptPath,
      json({
        state: 'captured',
        startedAt,
        requestSha256: hash(requestText),
        responseId: parsed.providerRequestId,
        totalTokens: parsed.usage?.totalTokens,
        artifactsReady,
      }),
    );
    console.log(
      json({ id, artifactsReady, usage: parsed.usage, responseId: parsed.providerRequestId }),
    );
  } catch (error) {
    // Preserve dispatch uncertainty and prohibit automated retries, including timeout/HTTP failures.
    writeFileSync(
      path.join(dir, 'failure.json'),
      json({
        error: error instanceof Error ? error.message : String(error),
        retry: false,
      }),
    );
    throw error;
  }
}

async function main(): Promise<void> {
  const [mode, argument, ...flags] = process.argv.slice(2);
  if (mode === 'prepare') {
    if (!argument) throw new Error('Provide private source-index JSON.');
    prepare(path.resolve(argument));
  } else if (mode === 'verify') {
    verify();
    console.log('Frozen input, request, contract and renderer identities verified; zero calls.');
  } else if (mode === 'smoke') await smoke();
  else if (mode === 'run') await run(argument as CaseId, flags);
  else if (mode === 'capture') {
    verify();
    if (!ids.includes(argument as CaseId)) throw new Error('Unknown frozen case.');
    const dir = caseDir(argument as CaseId);
    if (!existsSync(path.join(dir, 'attempt.json')))
      throw new Error('Only already-attempted cases can be recaptured.');
    const rawResponse = readFileSync(path.join(dir, 'response.raw.json'), 'utf8');
    const transport = readJson<{ responseSha256: string }>(path.join(dir, 'transport.json'));
    if (hash(rawResponse) !== transport.responseSha256)
      throw new Error('Original provider response changed.');
    const response = readJson(path.join(dir, 'response.json'));
    if (JSON.stringify(response) !== JSON.stringify(JSON.parse(rawResponse)))
      throw new Error('Parsed provider response changed.');
    await capture(dir, response, readJson(path.join(dir, 'context.json')));
  } else
    throw new Error(
      'Use prepare <private-index>, verify, smoke, run <case> --live --authorize=ESL-28, or capture <case>.',
    );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

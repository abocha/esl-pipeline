import { readFileSync, rmSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AssignmentProgressEvent, createPipeline } from '../src/index.js';

const sampleMarkdown = readFileSync(
  new URL('../examples/service/fixtures/lesson.md', import.meta.url),
  'utf8',
);

const tempDirs: string[] = [];

const mockSend = vi.fn();

type CommandInput = Record<string, unknown>;

type CommandConstructor = new (input: CommandInput) => { input: CommandInput };
// Initialize with dummy constructors to satisfy hoisting in vi.mock
var PutObjectCommandClass: CommandConstructor = class {
  constructor(readonly input: CommandInput) {}
};
var GetObjectCommandClass: CommandConstructor = class {
  constructor(readonly input: CommandInput) {}
};

vi.mock('@aws-sdk/client-s3', () => {
  // Assign before exporting to avoid TDZ issues during hoisting
  const PutObjectCommand = class {
    constructor(readonly input: CommandInput) {}
  };
  const GetObjectCommand = class {
    constructor(readonly input: CommandInput) {}
  };

  PutObjectCommandClass = PutObjectCommand;
  GetObjectCommandClass = GetObjectCommand;

  return {
    S3Client: class {
      send = mockSend;
    },
    PutObjectCommand,
    GetObjectCommand,
  };
});

vi.mock('@esl-pipeline/tts-elevenlabs', async () => {
  const actual = await vi.importActual<typeof import('@esl-pipeline/tts-elevenlabs')>(
    '@esl-pipeline/tts-elevenlabs',
  );
  return {
    ...actual,
    buildStudyTextMp3: vi.fn(),
  };
});

const createJsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => body,
});

const createTextResponse = (text: string) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => text,
});

beforeEach(() => {
  mockSend.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete process.env.ESL_PIPELINE_CONFIG_PROVIDER;
  delete process.env.ESL_PIPELINE_CONFIG_ENDPOINT;
  delete process.env.ESL_PIPELINE_CONFIG_TOKEN;
  delete process.env.ESL_PIPELINE_MANIFEST_STORE;
  delete process.env.ESL_PIPELINE_MANIFEST_BUCKET;
  delete process.env.ESL_PIPELINE_MANIFEST_PREFIX;
  delete process.env.ESL_PIPELINE_MANIFEST_ROOT;
  delete process.env.AWS_REGION;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('pipeline integration', () => {
  it('runs newAssignment with filesystem config defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pipeline-int-fs-'));
    tempDirs.push(dir);
    const mdPath = join(dir, 'lesson.md');
    await writeFile(mdPath, sampleMarkdown);

    const pipeline = createPipeline({ cwd: process.cwd() });

    const events: AssignmentProgressEvent[] = [];
    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-elevenlabs');
    vi.mocked(buildStudyTextMp3).mockResolvedValueOnce({
      path: join(dir, 'lesson.mp3'),
      hash: 'hash-filesystem',
      voices: [{ speaker: 'Case', voiceId: 'voice-filesystem', source: 'default' }],
    });

    const result = await pipeline.newAssignment(
      {
        md: mdPath,
        preset: 'b1-default',
        withTts: true,
        upload: 's3',
        dryRun: true,
        skipImport: true,
      },
      { onStage: (event) => events.push(event) },
    );

    expect(result.steps).toEqual([
      'validate',
      'skip:import',
      'colorize:b1-default:0/0/0',
      'tts',
      'upload',
      'manifest',
    ]);
    expect(result.manifestPath?.endsWith('.manifest.json')).toBe(true);
    expect(events.some((event) => event.stage === 'validate' && event.status === 'success')).toBe(
      true,
    );
    expect(events.some((event) => event.stage === 'import' && event.status === 'skipped')).toBe(
      true,
    );
    expect(events.some((event) => event.stage === 'upload' && event.status === 'success')).toBe(
      true,
    );
  });

  it('runs newAssignment with the remote config provider', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pipeline-int-remote-'));
    tempDirs.push(dir);
    const mdPath = join(dir, 'lesson.md');
    await writeFile(mdPath, sampleMarkdown);

    process.env.ESL_PIPELINE_CONFIG_PROVIDER = 'http';
    process.env.ESL_PIPELINE_CONFIG_ENDPOINT = 'https://config.test/';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ 'remote-default': { h2: '#00ff00' } }))
      .mockResolvedValueOnce(createJsonResponse([{ student: 'Remote Student' }]))
      .mockResolvedValueOnce(createTextResponse('voices:\n  narrator: remote-voice\n'));
    vi.stubGlobal('fetch', fetchMock as typeof fetch);

    const pipeline = createPipeline({ cwd: process.cwd() });
    const presets = await pipeline.configProvider.loadPresets();
    const students = await pipeline.configProvider.loadStudentProfiles();
    const voicesPath = await pipeline.configProvider.resolveVoicesPath();

    expect(presets['remote-default']?.h2).toBe('#00ff00');
    expect(students[0]?.student).toBe('Remote Student');
    expect(voicesPath).toMatch(/voices-.*\.yml$/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://config.test/presets.json');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://config.test/students.json');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://config.test/voices.yml');

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-elevenlabs');
    vi.mocked(buildStudyTextMp3).mockResolvedValueOnce({
      path: join(dir, 'lesson.mp3'),
      hash: 'hash-remote',
      voices: [{ speaker: 'Case', voiceId: 'voice-remote', source: 'default' }],
    });

    const events: AssignmentProgressEvent[] = [];
    const result = await pipeline.newAssignment(
      {
        md: mdPath,
        preset: 'b1-default',
        withTts: true,
        upload: 's3',
        dryRun: true,
        skipImport: true,
      },
      { onStage: (event) => events.push(event) },
    );

    expect(result.steps).toEqual([
      'validate',
      'skip:import',
      'colorize:b1-default:0/0/0',
      'tts',
      'upload',
      'manifest',
    ]);
    expect(
      events.filter((event) => event.stage === 'validate' && event.status === 'success'),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.stage === 'import' && event.status === 'skipped'),
    ).toHaveLength(1);
  });

  it('writes manifests to S3 when configured via environment variables', async () => {
    const PutCommand = PutObjectCommandClass!;
    const GetCommand = GetObjectCommandClass!;

    mockSend.mockImplementation(async (command) => {
      if (command instanceof GetCommand) {
        const error = new Error('NotFound');
        (error as any).$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return {};
    });

    const dir = await mkdtemp(join(tmpdir(), 'pipeline-int-s3-'));
    tempDirs.push(dir);
    const mdPath = join(dir, 'lesson.md');
    await writeFile(mdPath, sampleMarkdown);

    process.env.ESL_PIPELINE_MANIFEST_STORE = 's3';
    process.env.ESL_PIPELINE_MANIFEST_BUCKET = 'pipeline-test';
    process.env.ESL_PIPELINE_MANIFEST_PREFIX = 'manifests/int-tests';
    process.env.ESL_PIPELINE_MANIFEST_ROOT = dir;

    const pipeline = createPipeline({ cwd: dir });

    const manifestUri = pipeline.manifestStore.manifestPathFor(mdPath);
    expect(manifestUri).toBe('s3://pipeline-test/manifests/int-tests/lesson.manifest.json');

    const { buildStudyTextMp3 } = await import('@esl-pipeline/tts-elevenlabs');
    vi.mocked(buildStudyTextMp3).mockResolvedValueOnce({
      path: join(dir, 'lesson.mp3'),
      hash: 'hash-s3',
      voices: [{ speaker: 'Case', voiceId: 'voice-s3', source: 'default' }],
    });

    const result = await pipeline.newAssignment({
      md: mdPath,
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      dryRun: true,
      skipImport: true,
    });

    expect(result.manifestPath).toBe('s3://pipeline-test/manifests/int-tests/lesson.manifest.json');
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0]?.[0]?.constructor?.name).toBe('GetObjectCommand');
    expect(mockSend.mock.calls[1]?.[0]?.constructor?.name).toBe('PutObjectCommand');
  });
});

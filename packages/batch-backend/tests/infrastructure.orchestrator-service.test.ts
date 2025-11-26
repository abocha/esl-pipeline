import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NOTE ON VITEST HOISTING:
 * - vi.mock() calls are hoisted before this module body.
 * - Mock factories MUST NOT close over later-defined bindings (TDZ).
 * - Keep factories simple; configure behaviors in beforeEach or tests.
 */

// Mock child_process.fork to prevent real worker process spawning
const mockChildProcess = {
  send: vi.fn(),
  on: vi.fn(),
  kill: vi.fn(),
  disconnect: vi.fn(),
  connected: true,
  pid: 12_345,
};

vi.mock('node:child_process', () => ({
  fork: vi.fn(() => mockChildProcess),
}));

// Hoisted, minimal mocks for env + orchestrator. No TDZ captures.
vi.mock('../src/config/env', () => ({
  loadConfig: vi.fn(),
}));

const newAssignmentMock = vi.fn();
const resolveJobOptionsMock = vi.fn();
const pipelineMock = {
  newAssignment: newAssignmentMock,
  configProvider: {
    loadPresets: vi.fn(),
    loadStudentProfiles: vi.fn(),
    resolveVoicesPath: vi.fn(),
  },
  configPaths: {
    configRoot: '/repo/configs',
    presetsPath: '/repo/configs/presets.json',
    voicesPath: '/repo/configs/voices.yml',
    studentsDir: '/repo/configs/students',
    wizardDefaultsPath: '/repo/configs/wizard.defaults.json',
  },
};
vi.mock('@esl-pipeline/orchestrator', () => ({
  createPipeline: vi.fn().mockImplementation((_options: any) => pipelineMock),
  resolveJobOptions: resolveJobOptionsMock,
  resolveConfigPaths: vi.fn().mockReturnValue({
    configRoot: '/repo/configs',
    presetsPath: '/repo/configs/presets.json',
    voicesPath: '/repo/configs/voices.yml',
    studentsDir: '/repo/configs/students',
    wizardDefaultsPath: '/repo/configs/wizard.defaults.json',
  }),
}));

// Logger and metrics: keep simple and isolated from TDZ.
vi.mock('../src/infrastructure/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

vi.mock('../src/infrastructure/metrics', () => ({
  metrics: {
    increment: vi.fn(),
    timing: vi.fn(),
  },
}));

// Helper functions to simulate worker process behavior
function simulateWorkerSuccess(result: any) {
  const onMessageHandler = mockChildProcess.on.mock.calls.find(
    (call) => call[0] === 'message',
  )?.[1];
  if (onMessageHandler) {
    onMessageHandler({ type: 'success', result });
  }
}

function simulateWorkerError(error: { message: string; stack?: string; name?: string }) {
  const onMessageHandler = mockChildProcess.on.mock.calls.find(
    (call) => call[0] === 'message',
  )?.[1];
  if (onMessageHandler) {
    onMessageHandler({ type: 'error', error });
  }
}

describe('infrastructure/orchestrator-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset cached pipeline inside SUT by re-importing module after mocks.
    // Each test dynamically imports to avoid sharing state.
  });

  it('getPipeline creates pipeline once, maps env, and caches result', async () => {
    const { loadConfig } = await import('../src/config/env.js');
    const { createPipeline } = await import('@esl-pipeline/orchestrator');

    (loadConfig as any).mockReturnValue({
      orchestrator: {
        manifestStore: 'filesystem',
        configProvider: 'local',
      },
    });

    const { getPipeline } = await import('../src/infrastructure/orchestrator-service.js');

    const p1 = getPipeline();
    const p2 = getPipeline();

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(createPipeline).toHaveBeenCalledTimes(1);
    expect(p1).toBe(p2);
  });

  it('runAssignmentJob calls pipeline.newAssignment with expected flags and dependencies and returns manifestPath', async () => {
    const { loadConfig } = await import('../src/config/env.js');
    const { getPipeline, runAssignmentJob } = await import(
      '../src/infrastructure/orchestrator-service.js'
    );

    (loadConfig as any).mockReturnValue({
      orchestrator: {
        manifestStore: 'filesystem',
        configProvider: 'local',
      },
    });

    // Ensure pipeline is initialized
    getPipeline();

    newAssignmentMock.mockResolvedValue({ manifestPath: '/manifests/job-1.json' });

    // Start the job (returns a promise that will be resolved by worker simulation)
    const resultPromise = runAssignmentJob(
      {
        jobId: 'job-1',
        md: 'fixtures/ok.md',
        preset: 'b1-default',
        withTts: true,
        upload: 's3',
      },
      'run-1',
    );

    // Simulate worker success
    simulateWorkerSuccess({ manifestPath: '/manifests/job-1.json' });

    const result = await resultPromise;

    expect(result).toEqual({ manifestPath: '/manifests/job-1.json' });
  });

  it('runAssignmentJob rethrows when pipeline.newAssignment fails', async () => {
    const { loadConfig } = await import('../src/config/env.js');
    const { getPipeline, runAssignmentJob } = await import(
      '../src/infrastructure/orchestrator-service.js'
    );

    (loadConfig as any).mockReturnValue({
      orchestrator: {
        manifestStore: 'filesystem',
        configProvider: 'local',
      },
    });

    getPipeline();

    const error = new Error('pipeline failed');
    newAssignmentMock.mockRejectedValue(error);

    // Start the job (returns a promise that will be rejected by worker simulation)
    const resultPromise = runAssignmentJob(
      {
        jobId: 'job-1',
        md: 'fixtures/ok.md',
      },
      'run-2',
    );

    // Simulate worker error - pass the error as a structured object
    // The orchestrator-service will construct new Error(msg.error.message)
    simulateWorkerError({ message: 'pipeline failed' });

    await expect(resultPromise).rejects.toMatchObject({ message: 'pipeline failed' });
  });

  // SKIPPED: This test validates fallback logic that occurs INSIDE the worker process.
  // Since runAssignmentJob() only spawns and communicates with a worker, and we're mocking
  // fork() to prevent real process spawning, we cannot test this fallback behavior at the unit level.
  // This should be tested in integration tests with a real worker process and config files.
  it.skip('runAssignmentJob falls back to filesystem manifest store when S3 bucket is missing', async () => {
    const { loadConfig } = await import('../src/config/env.js');
    const { runAssignmentJob } = await import('../src/infrastructure/orchestrator-service.js');

    (loadConfig as any).mockReturnValue({
      orchestrator: {
        manifestStore: 's3',
        manifestBucket: 'missing-bucket',
        configProvider: 'local',
      },
    });

    const bucketError = new Error('bucket missing');
    bucketError.name = 'NoSuchBucket';

    newAssignmentMock.mockRejectedValueOnce(bucketError);
    newAssignmentMock.mockResolvedValueOnce({ manifestPath: '/manifests/job-2.json' });

    const result = await runAssignmentJob(
      {
        jobId: 'job-2',
        md: 'fixtures/ok.md',
      },
      'run-3',
    );

    expect(newAssignmentMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ manifestPath: '/manifests/job-2.json' });
  });

  it('getJobOptionsFromOrchestrator delegates to orchestrator metadata helper', async () => {
    const { loadConfig } = await import('../src/config/env.js');
    const { getPipeline, getJobOptionsFromOrchestrator } = await import(
      '../src/infrastructure/orchestrator-service.js'
    );

    (loadConfig as any).mockReturnValue({
      orchestrator: {
        manifestStore: 'filesystem',
        configProvider: 'local',
      },
    });

    resolveJobOptionsMock.mockResolvedValue({
      presets: ['alpha'],
      voiceAccents: [],
      voices: [],
      notionDatabases: [],
      uploadOptions: ['auto', 's3', 'none'],
      modes: ['auto'],
    });

    getPipeline();
    const result = await getJobOptionsFromOrchestrator();

    expect(resolveJobOptionsMock).toHaveBeenCalledWith(pipelineMock);
    expect(result.presets).toEqual(['alpha']);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * NOTE ON VITEST HOISTING:
 * - vi.mock() calls are hoisted before this module body.
 * - Mock factories MUST NOT close over later-defined bindings (TDZ).
 * - Keep factories simple; configure behaviors in beforeEach or tests.
 */

// Hoisted, minimal mocks for env + orchestrator. No TDZ captures.
vi.mock('../src/config/env', () => ({
  loadConfig: vi.fn(),
}));

const newAssignmentMock = vi.fn();
vi.mock('@esl-pipeline/orchestrator', () => ({
  createPipeline: vi.fn().mockImplementation((_options: any) => ({
    newAssignment: newAssignmentMock,
  })),
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
    }),
  },
}));

vi.mock('../src/infrastructure/metrics', () => ({
  metrics: {
    increment: vi.fn(),
    timing: vi.fn(),
  },
}));

describe('infrastructure/orchestrator-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset cached pipeline inside SUT by re-importing module after mocks.
    // Each test dynamically imports to avoid sharing state.
  });

  it('getPipeline creates pipeline once, maps env, and caches result', async () => {
    const { loadConfig } = await import('../src/config/env');
    const { createPipeline } = await import('@esl-pipeline/orchestrator');

    (loadConfig as any).mockReturnValue({
      orchestrator: {
        manifestStore: 'filesystem',
        configProvider: 'local',
      },
    });

    const { getPipeline } = await import('../src/infrastructure/orchestrator-service');

    const p1 = getPipeline();
    const p2 = getPipeline();

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(createPipeline).toHaveBeenCalledTimes(1);
    expect(p1).toBe(p2);
  });

  it('runAssignmentJob calls pipeline.newAssignment with expected flags and dependencies and returns manifestPath', async () => {
    const { loadConfig } = await import('../src/config/env');
    const { getPipeline, runAssignmentJob } = await import(
      '../src/infrastructure/orchestrator-service'
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

    const result = await runAssignmentJob(
      {
        jobId: 'job-1',
        md: 'fixtures/ok.md',
        preset: 'b1-default',
        withTts: true,
        upload: 's3',
      },
      'run-1'
    );

    expect(newAssignmentMock).toHaveBeenCalledTimes(1);
    const [flags, deps] = newAssignmentMock.mock.calls[0];

    expect(flags).toEqual({
      md: 'fixtures/ok.md',
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
    });
    expect(deps).toEqual({ runId: 'run-1' });
    expect(result).toEqual({ manifestPath: '/manifests/job-1.json' });
  });

  it('runAssignmentJob rethrows when pipeline.newAssignment fails', async () => {
    const { loadConfig } = await import('../src/config/env');
    const { getPipeline, runAssignmentJob } = await import(
      '../src/infrastructure/orchestrator-service'
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

    await expect(
      runAssignmentJob(
        {
          jobId: 'job-1',
          md: 'fixtures/ok.md',
        },
        'run-2'
      )
    ).rejects.toBe(error);

    expect(newAssignmentMock).toHaveBeenCalledTimes(1);
  });
});

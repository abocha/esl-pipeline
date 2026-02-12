import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/infrastructure/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../src/infrastructure/orchestrator-service', () => ({
  getJobOptionsFromOrchestrator: vi.fn(),
}));

describe('application/get-job-options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.NOTION_DB_ID;
    delete process.env.NOTION_DB_NAME;
    delete process.env.NOTION_DB_LABEL;
    delete process.env.NOTION_DB_OPTIONS;
  });

  it('returns orchestrator metadata when helper succeeds', async () => {
    const { getJobOptions } = await import('../src/application/get-job-options.js');
    const { getJobOptionsFromOrchestrator } =
      await import('../src/infrastructure/orchestrator-service.js');

    vi.mocked(getJobOptionsFromOrchestrator).mockResolvedValue({
      presets: ['alpha'],
      cefrLevels: ['A2', 'B1', 'B2'],
      cefrDefault: 'B1',
      voiceAccents: ['accent_one'],
      voices: [{ id: 'voice-1', name: 'Voice One', accent: 'accent_one', gender: 'female' }],
      notionDatabases: [{ id: 'db-1', name: 'DB One' }],
      uploadOptions: ['auto', 's3', 'none'],
      ttsStrategies: ['auto', 'dialogue', 'tts'],
      learningPresets: [
        {
          id: 'general-english',
          version: 'v1',
          alias: 'current',
          title: 'General English',
          track: 'general-english',
          status: 'active',
          promptSnapshotVersion: 'hw_prompt_v4-2_clean',
        },
      ],
    } as any);

    const result = await getJobOptions();

    expect(result).toEqual({
      presets: ['alpha'],
      cefrLevels: ['A2', 'B1', 'B2'],
      cefrDefault: 'B1',
      voiceAccents: ['accent_one'],
      voices: [{ id: 'voice-1', name: 'Voice One', accent: 'accent_one', gender: 'female' }],
      notionDatabases: [{ id: 'db-1', name: 'DB One' }],
      uploadOptions: ['auto', 's3', 'none'],
      ttsStrategies: ['auto', 'dialogue', 'tts'],
      learningPresets: [
        {
          id: 'general-english',
          version: 'v1',
          alias: 'current',
          title: 'General English',
          track: 'general-english',
          status: 'active',
          promptSnapshotVersion: 'hw_prompt_v4-2_clean',
        },
      ],
      supportedActions: [
        {
          type: 'rerun_audio',
          label: 'Rerun Audio Generation',
          description: 'Regenerate TTS audio for this job with optional voice/TTS overrides',
          requiresFields: [],
          implemented: true,
        },
        {
          type: 'rerun_publish',
          label: 'Rerun Publish',
          description:
            'Rerun publish/attach stage while reusing existing audio artifacts when possible',
          requiresFields: [],
          implemented: true,
        },
        {
          type: 'cancel',
          label: 'Cancel Job',
          description: 'Cancel a queued or running job',
          requiresFields: [],
          implemented: true,
        },
        {
          type: 'edit_metadata',
          label: 'Edit Job Metadata',
          description: 'Update job configuration without rerunning',
          requiresFields: [],
          implemented: true,
        },
      ],
    });
  });

  it('falls back to static options when orchestrator helper fails', async () => {
    const { getJobOptions } = await import('../src/application/get-job-options.js');
    const { getJobOptionsFromOrchestrator } =
      await import('../src/infrastructure/orchestrator-service.js');
    const { logger } = await import('../src/infrastructure/logger.js');

    vi.mocked(getJobOptionsFromOrchestrator).mockRejectedValue(new Error('boom'));

    const result = await getJobOptions();

    expect(result.presets).toEqual(['b1-default']);
    expect(result.cefrLevels).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    expect(result.cefrDefault).toEqual('B1');
    expect(result.uploadOptions).toEqual(['auto', 's3', 'none']);
    expect(result.ttsStrategies).toEqual(['auto']);
    expect(result.learningPresets).toEqual([
      {
        id: 'general-english',
        version: 'v1',
        alias: 'current',
        title: 'General English',
        track: 'general-english',
        status: 'active',
        promptSnapshotVersion: 'hw_prompt_v4-2_clean',
      },
    ]);
    expect(result.notionDatabases).toEqual([
      { id: 'notion-db-b1', name: 'B1 Lessons' },
      { id: 'notion-db-b2', name: 'B2 Lessons' },
    ]);
    expect(result.voiceAccents.length).toBeGreaterThan(0);
    expect(Array.isArray(result.voices)).toBe(true);
    expect(result.supportedActions).toHaveLength(4);

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to load job options from orchestrator. Falling back to static config.',
      expect.objectContaining({ error: 'boom' }),
    );
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

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
    const { getJobOptions } = await import('../src/application/get-job-options');
    const { getJobOptionsFromOrchestrator } = await import(
      '../src/infrastructure/orchestrator-service'
    );

    vi.mocked(getJobOptionsFromOrchestrator).mockResolvedValue({
      presets: ['alpha'],
      voiceAccents: ['accent_one'],
      voices: [{ id: 'voice-1', name: 'Voice One', accent: 'accent_one', gender: 'female' }],
      notionDatabases: [{ id: 'db-1', name: 'DB One' }],
      uploadOptions: ['auto', 's3', 'none'],
      modes: ['auto', 'dialogue', 'monologue'],
    });

    const result = await getJobOptions();

    expect(result).toEqual({
      presets: ['alpha'],
      voiceAccents: ['accent_one'],
      voices: [{ id: 'voice-1', name: 'Voice One', accent: 'accent_one', gender: 'female' }],
      notionDatabases: [{ id: 'db-1', name: 'DB One' }],
      uploadOptions: ['auto', 's3', 'none'],
      modes: ['auto', 'dialogue', 'monologue'],
    });
  });

  it('falls back to static options when orchestrator helper fails', async () => {
    const { getJobOptions } = await import('../src/application/get-job-options');
    const { getJobOptionsFromOrchestrator } = await import(
      '../src/infrastructure/orchestrator-service'
    );
    const { logger } = await import('../src/infrastructure/logger');

    vi.mocked(getJobOptionsFromOrchestrator).mockRejectedValue(new Error('boom'));

    const result = await getJobOptions();

    expect(result.presets).toEqual(['b1-default']);
    expect(result.uploadOptions).toEqual(['auto', 's3', 'none']);
    expect(result.modes).toEqual(['auto']);
    expect(result.notionDatabases).toEqual([
      { id: 'notion-db-b1', name: 'B1 Lessons' },
      { id: 'notion-db-b2', name: 'B2 Lessons' },
    ]);
    expect(result.voiceAccents.length).toBeGreaterThan(0);
    expect(result.voices.length).toBeGreaterThan(0);

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to load job options from orchestrator. Falling back to static config.',
      expect.objectContaining({ error: 'boom' })
    );
  });
});

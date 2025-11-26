import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadVoicesCatalog } from '@esl-pipeline/tts-elevenlabs';

import type { ConfigProvider } from '../src/config.js';
import { resolveJobOptions } from '../src/metadata/job-options.js';
import type { ResolvedConfigPaths } from '../src/pipeline.js';

vi.mock('@esl-pipeline/tts-elevenlabs', () => ({
  loadVoicesCatalog: vi.fn(),
}));

const configPaths: ResolvedConfigPaths = {
  configRoot: '/repo/configs',
  presetsPath: '/repo/configs/presets.json',
  voicesPath: '/repo/configs/voices.yml',
  studentsDir: '/repo/configs/students',
  wizardDefaultsPath: '/repo/configs/wizard.defaults.json',
};

function createConfigProvider(overrides: Partial<ConfigProvider> = {}): ConfigProvider {
  const base: ConfigProvider = {
    loadPresets: vi.fn().mockResolvedValue({}),
    loadStudentProfiles: vi.fn().mockResolvedValue([]),
    resolveVoicesPath: vi.fn().mockResolvedValue(void 0),
  };
  return { ...base, ...overrides };
}

describe('metadata/job-options', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns orchestrator-backed presets, voices, and notion databases', async () => {
    const configProvider = createConfigProvider({
      loadPresets: vi.fn().mockResolvedValue({
        'b1-default': {},
        'b2-alt': {},
      }),
      loadStudentProfiles: vi.fn().mockResolvedValue([
        { student: 'Anna', dbId: 'db-123' },
        { student: 'Leo', dbId: 'db-456' },
      ]),
    });

    vi.mocked(loadVoicesCatalog).mockResolvedValue({
      voices: [
        {
          id: 'voice_a',
          name: 'Amanda',
          category: 'narration',
          labels: { accent: 'American', gender: 'Female' },
        },
        {
          id: 'voice_b',
          name: 'Luke',
          labels: { accent: 'British', gender: 'Male' },
        },
      ],
    });

    const result = await resolveJobOptions({ configProvider, configPaths });

    expect(configProvider.loadPresets).toHaveBeenCalledWith(configPaths.presetsPath);
    expect(configProvider.loadStudentProfiles).toHaveBeenCalledWith(configPaths.studentsDir);
    expect(loadVoicesCatalog).toHaveBeenCalledTimes(1);

    expect(result.presets).toEqual(['b1-default', 'b2-alt']);
    expect(result.notionDatabases).toEqual([
      { id: 'db-123', name: 'Anna' },
      { id: 'db-456', name: 'Leo' },
    ]);
    expect(result.uploadOptions).toEqual(['auto', 's3', 'none']);
    expect(result.modes).toEqual(['auto', 'dialogue', 'monologue']);
    expect(result.voices).toEqual([
      {
        id: 'voice_a',
        name: 'Amanda',
        category: 'narration',
        accent: 'american_female',
        gender: 'female',
      },
      {
        id: 'voice_b',
        name: 'Luke',
        category: null,
        accent: 'british_male',
        gender: 'male',
      },
    ]);
    expect(result.voiceAccents).toEqual(['american_female', 'british_male']);
  });

  it('omits duplicate/missing databases and tolerates empty voice catalogs', async () => {
    const configProvider = createConfigProvider({
      loadPresets: vi.fn().mockResolvedValue({}),
      loadStudentProfiles: vi
        .fn()
        .mockResolvedValue([
          { student: 'Anna', dbId: 'db-123' },
          { student: 'Duplicate', dbId: 'db-123' },
          { student: 'No DB' },
        ]),
    });
    vi.mocked(loadVoicesCatalog).mockResolvedValue({ voices: [] });

    const result = await resolveJobOptions({ configProvider, configPaths });

    expect(result.notionDatabases).toEqual([{ id: 'db-123', name: 'Anna' }]);
    expect(result.voices).toEqual([]);
    expect(result.voiceAccents).toEqual([]);
  });
});

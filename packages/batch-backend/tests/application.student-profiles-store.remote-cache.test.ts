import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveStudentId } from '../src/domain/student-utils.js';

const STUDENT_PROFILES_REMOTE_CACHE_TEST_TIMEOUT_MS = 30_000;

vi.mock('../src/infrastructure/orchestrator-service.js', () => ({
  getStudentProfilesFromOrchestrator: vi.fn(),
}));

describe('student-profiles-store remote cache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses remote profiles within cache TTL and refreshes after expiry', async () => {
    const { listStudentProfiles, getStudentProfileById } = await import(
      '../src/application/student-profiles-store.js'
    );
    const { loadConfig } = await import('../src/config/env.js');
    const { getStudentProfilesFromOrchestrator } = await import(
      '../src/infrastructure/orchestrator-service.js'
    );

    vi.mocked(getStudentProfilesFromOrchestrator).mockResolvedValue([
      {
        student: 'Alex',
        dbId: 'db-1',
        pageParentId: null,
        colorPreset: 'b1-default',
        accentPreference: null,
        manifestPreset: null,
        profileId: null,
        voices: {},
      },
    ]);

    const baseConfig = loadConfig();
    const config = {
      ...baseConfig,
      orchestrator: {
        ...baseConfig.orchestrator,
        configProvider: 'http' as const,
      },
    };

    const listed = await listStudentProfiles({}, { config });
    expect(listed.items).toHaveLength(1);

    const profile = await getStudentProfileById(deriveStudentId('Alex'), { config });
    expect(profile?.student).toBe('Alex');
    expect(getStudentProfilesFromOrchestrator).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-02-01T00:01:01.000Z'));
    await listStudentProfiles({}, { config });
    expect(getStudentProfilesFromOrchestrator).toHaveBeenCalledTimes(2);
  }, STUDENT_PROFILES_REMOTE_CACHE_TEST_TIMEOUT_MS);
});

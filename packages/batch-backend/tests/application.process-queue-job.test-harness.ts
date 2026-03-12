import path from 'node:path';

import { beforeEach, vi } from 'vitest';

import * as jobEvents from '../src/domain/job-events.js';
import * as jobRepository from '../src/domain/job-repository.js';
import * as settingsRepository from '../src/domain/settings-repository.js';
import * as loggerModule from '../src/infrastructure/logger.js';
import * as orchestratorService from '../src/infrastructure/orchestrator-service.js';
import * as transcriptionStorage from '../src/infrastructure/transcription-storage.js';
import * as ttsCacheMaintenanceCoordinator from '../src/infrastructure/tts-cache-maintenance-coordinator.js';
import type { JobRecord } from '../src/domain/job-model.js';

vi.mock('../src/infrastructure/logger', async () => {
  const actual = await vi.importActual<typeof loggerModule>('../src/infrastructure/logger');
  return {
    ...actual,
    createJobLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

export const getJobByIdSpy = vi.spyOn(jobRepository, 'getJobById');
export const updateJobStateAndResultSpy = vi.spyOn(jobRepository, 'updateJobStateAndResult');
export const runAssignmentJobSpy = vi.spyOn(orchestratorService, 'runAssignmentJob');
export const runRerunAssignmentJobSpy = vi.spyOn(orchestratorService, 'runRerunAssignmentJob');
export const publishJobEventSpy = vi.spyOn(jobEvents, 'publishJobEvent');
export const getSettingsByUserIdSpy = vi.spyOn(settingsRepository, 'getSettingsByUserId');
export const getDecryptedElevenLabsKeySpy = vi.spyOn(settingsRepository, 'getDecryptedElevenLabsKey');
export const getDecryptedNotionTokenSpy = vi.spyOn(settingsRepository, 'getDecryptedNotionToken');
export const createTranscriptionStorageForUriSpy = vi.spyOn(
  transcriptionStorage,
  'createTranscriptionStorageForUri',
);
export const maybeRunTtsCacheMaintenanceWithPgLockSpy = vi.spyOn(
  ttsCacheMaintenanceCoordinator,
  'maybeRunTtsCacheMaintenanceWithPgLock',
);
export const withTtsCacheActivitySharedLockSpy = vi.spyOn(
  ttsCacheMaintenanceCoordinator,
  'withTtsCacheActivitySharedLock',
);

beforeEach(() => {
  vi.clearAllMocks();
  maybeRunTtsCacheMaintenanceWithPgLockSpy.mockResolvedValue({
    ran: false,
    reason: 'interval',
    scannedFiles: 0,
    deletedFiles: 0,
    reclaimedBytes: 0,
    remainingBytes: 0,
  });
  withTtsCacheActivitySharedLockSpy.mockImplementation(async (_options, callback) => callback());
});

export function makeJob(
  overrides: Partial<JobRecord> = {},
): JobRecord {
  const now = new Date('2024-01-01T10:00:00Z');
  return {
    id: 'job-1',
    state: 'queued',
    md: path.resolve(import.meta.dirname, '../../../fixtures/ok.md'),
    mdStorageUri: null,
    preset: 'b1-default',
    withTts: true,
    upload: 's3',
    voiceId: 'voice_amanda',
    voiceAccent: 'american_female',
    forceTts: false,
    notionDatabase: 'db-123',
    publishTarget: 'notion',
    ttsStrategy: 'auto',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    error: null,
    manifestPath: null,
    ...overrides,
  };
}

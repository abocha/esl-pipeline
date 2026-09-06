import { describe, expect, it } from 'vitest';

import {
  API_CONTRACT_VERSION,
  DB_CONTRACT_VERSION,
  DB_MIGRATION_HEAD,
} from '../../contracts/src/contract-versions.js';

describe('manual transcript contract versions', () => {
  it('tracks the upload-operation contract', () => {
    expect(API_CONTRACT_VERSION).toBe('4.4.0');
    expect(DB_CONTRACT_VERSION).toBe('0.30.0');
    expect(DB_MIGRATION_HEAD).toBe('0052_recording_upload_candidate_cleanup_schedule');
  });
});

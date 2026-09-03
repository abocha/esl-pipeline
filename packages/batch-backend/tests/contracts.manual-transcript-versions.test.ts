import { describe, expect, it } from 'vitest';

import {
  API_CONTRACT_VERSION,
  DB_CONTRACT_VERSION,
  DB_MIGRATION_HEAD,
} from '../../contracts/src/contract-versions.js';

describe('manual transcript contract versions', () => {
  it('tracks the current post-cutover assignment contract', () => {
    expect(API_CONTRACT_VERSION).toBe('4.3.0');
    expect(DB_CONTRACT_VERSION).toBe('0.27.0');
    expect(DB_MIGRATION_HEAD).toBe('0049_recording_ingest_readiness');
  });
});

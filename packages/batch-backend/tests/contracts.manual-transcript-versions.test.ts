import { describe, expect, it } from 'vitest';

import {
  API_CONTRACT_VERSION,
  DB_CONTRACT_VERSION,
  DB_MIGRATION_HEAD,
} from '../../contracts/src/contract-versions.js';

describe('manual transcript contract versions', () => {
  it('tracks the backward-compatible API and DB expansion', () => {
    expect(API_CONTRACT_VERSION).toBe('3.1.0');
    expect(DB_CONTRACT_VERSION).toBe('0.22.0');
    expect(DB_MIGRATION_HEAD).toBe('0043_manual_transcript_source');
  });
});

import { describe, expect, it } from 'vitest';

import {
  API_CONTRACT_VERSION,
  DB_CONTRACT_VERSION,
  DB_MIGRATION_HEAD,
} from '../../contracts/src/contract-versions.js';

describe('manual transcript contract versions', () => {
  it('tracks the current contract versions', () => {
    expect(API_CONTRACT_VERSION).toBe('4.5.0');
    expect(DB_CONTRACT_VERSION).toBe('0.31.0');
    expect(DB_MIGRATION_HEAD).toBe('0055_prompt_package_assignment_provenance');
  });
});

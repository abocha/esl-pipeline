import { describe, expect, it } from 'vitest';

import {
  API_CONTRACT_VERSION,
  DB_CONTRACT_VERSION,
  DB_MIGRATION_HEAD,
} from '../../contracts/src/contract-versions.js';

describe('contracts/assignment confirmation contract version', () => {
  it('publishes the coordinated hard-cutover contract versions', () => {
    expect(API_CONTRACT_VERSION).toBe('4.0.0');
    expect(DB_CONTRACT_VERSION).toBe('0.23.0');
    expect(DB_MIGRATION_HEAD).toBe('0044_assignment_step_confirmation_contract');
  });
});

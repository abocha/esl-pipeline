import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  API_CONTRACT_VERSION,
  DB_CONTRACT_VERSION,
  DB_MIGRATION_HEAD,
} from '../../contracts/src/contract-versions.js';
import type { AssignmentSessionDto } from '../../contracts/src/index.js';

describe('contracts/assignment confirmation contract version', () => {
  it('publishes the current assignment contract versions', () => {
    expect(API_CONTRACT_VERSION).toBe('5.0.0');
    expect(DB_CONTRACT_VERSION).toBe('0.32.0');
    expect(DB_MIGRATION_HEAD).toBe('0057_historical_profile_provenance_timestamp');
  });

  it('does not expose a nullable legacy learner on an assignment session', () => {
    expectTypeOf<AssignmentSessionDto['studentId']>().toEqualTypeOf<string>();
  });
});

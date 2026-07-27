import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  API_CONTRACT_VERSION,
  DB_CONTRACT_VERSION,
  DB_MIGRATION_HEAD,
} from '../../contracts/src/contract-versions.js';
import type { AssignmentSessionDto } from '../../contracts/src/index.js';

describe('contracts/assignment confirmation contract version', () => {
  it('publishes the current post-cutover contract versions', () => {
    expect(API_CONTRACT_VERSION).toBe('4.1.0');
    expect(DB_CONTRACT_VERSION).toBe('0.23.1');
    expect(DB_MIGRATION_HEAD).toBe('0045_student_memory_snapshot_eligibility_repair');
  });

  it('does not expose a nullable legacy learner on an assignment session', () => {
    expectTypeOf<AssignmentSessionDto['studentId']>().toEqualTypeOf<string>();
  });
});

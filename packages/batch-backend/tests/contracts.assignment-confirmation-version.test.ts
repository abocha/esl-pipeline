import { describe, expectTypeOf, it } from 'vitest';

import type { AssignmentSessionDto } from '../../contracts/src/index.js';

describe('contracts/assignment confirmation', () => {
  it('does not expose a nullable legacy learner on an assignment session', () => {
    expectTypeOf<AssignmentSessionDto['studentId']>().toEqualTypeOf<string>();
  });
});

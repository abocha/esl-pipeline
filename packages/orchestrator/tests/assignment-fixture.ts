import { readFileSync } from 'node:fs';

import type { AssignmentV1 } from '@esl-pipeline/contracts';

export function assignmentFixture(): AssignmentV1 {
  const assignment = JSON.parse(
    readFileSync(new URL('../../contracts/tests/assignment-fixture.json', import.meta.url), 'utf8'),
  ) as AssignmentV1;
  assignment.pronunciation = null;
  return assignment;
}

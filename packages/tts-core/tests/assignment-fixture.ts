import { readFileSync } from 'node:fs';

import type { AssignmentV1 } from '@esl-pipeline/contracts';

/** Author typed provider fixtures while sharing unrelated lesson fields. */
export function createTtsAssignment(options: {
  metadata: AssignmentV1['metadata'];
  studyText: AssignmentV1['input']['studyText'];
  pronunciation: AssignmentV1['pronunciation'];
}): AssignmentV1 {
  const assignment = JSON.parse(
    readFileSync(new URL('../../contracts/tests/assignment-fixture.json', import.meta.url), 'utf8'),
  ) as AssignmentV1;
  assignment.metadata = options.metadata;
  assignment.input.studyText = options.studyText;
  assignment.pronunciation = options.pronunciation;
  return assignment;
}

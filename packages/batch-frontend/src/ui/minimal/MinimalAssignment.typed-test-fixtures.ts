import { type AssignmentV1, serializeAssignmentV1 } from '@esl-pipeline/contracts';

import { editorFixture } from '../../dev/assignment-editor-fixture';

export const assignmentContext = {
  studentName: 'Alex',
  inputKind: 'generate' as const,
  suppliedUrls: [],
};
export const requestEnvelope = { promptVersion: 'assignment_v1', assignmentContext };
export function makeAssignmentText(title: string): string {
  const assignment: AssignmentV1 = editorFixture();
  assignment.metadata.title = title.replace(/^#\s+/, '').trim();
  assignment.metadata.student = 'Alex';
  return serializeAssignmentV1(assignment);
}
export function typedDraftFields(text: string) {
  return {
    format: 'assignment_v1' as const,
    artifact: assignmentArtifact,
    assignment: JSON.parse(text) as AssignmentV1,
    validationContext: assignmentContext,
  };
}
export const assignmentArtifact = {
  format: 'assignment_v1' as const,
  schemaVersion: 1 as const,
  serializationVersion: 1 as const,
  workingVersion: 1,
  storageUri: 'memory://draft/content.json',
  contentHash: 'b'.repeat(64),
};

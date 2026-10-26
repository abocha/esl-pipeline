import {
  type AssignmentMaterial,
  ConfirmedAssignmentMaterialSchema,
} from '@esl-pipeline/contracts';

export function assignmentMaterialErrors(material: AssignmentMaterial): Record<string, string> {
  const parsed = ConfirmedAssignmentMaterialSchema.safeParse(material);
  return parsed.success
    ? {}
    : Object.fromEntries(
        parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
      );
}

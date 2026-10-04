import { z } from 'zod';

import {
  type AssignmentV1,
  type AssignmentValidationContext,
  validateAssignmentV1,
} from './assignment-v1.js';

export type AssignmentFormat = 'markdown' | 'assignment_v1';

/** Frozen canonical input. PMD, HTML and audio identities remain separate. */
export const AssignmentArtifactReferenceSchema = z.strictObject({
  format: z.literal('assignment_v1'),
  schemaVersion: z.literal(1),
  serializationVersion: z.literal(1),
  workingVersion: z.number().int().positive(),
  storageUri: z.string().min(1),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type AssignmentArtifactReference = z.infer<typeof AssignmentArtifactReferenceSchema>;

/** Version 1: sorted object keys, preserved array order and exact field strings. */
export function serializeAssignmentV1(assignment: AssignmentV1): string {
  return JSON.stringify(assignment, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return value;
  });
}

export function parseAssignmentV1(
  text: string,
  context: AssignmentValidationContext = {},
): AssignmentV1 {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Assignment JSON syntax error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateAssignmentV1(value, context);
}

export interface AssignmentDraftDto {
  id: string;
  promptPackageId: string;
  studentId: string | null;
  lessonId?: string | null;
  storageUri: string;
  workingVersion: number | null;
  contentHash: string | null;
  createdBy: string | null;
  /** Explicit legacy text or pretty-printed validated JSON; never an invalid saved buffer. */
  text: string;
  format?: AssignmentFormat;
  artifact?: AssignmentArtifactReference;
  assignment?: AssignmentV1;
  validationContext?: AssignmentValidationContext;
  createdAt: string;
  updatedAt: string;
}

/** Versioned publication metadata; absent on historical DTOs/manifests. */
export interface AssignmentPublicationMetadata {
  schemaVersion: 1;
  rendererVersion: 1 | 2;
  title: string;
  icon: string;
  studyTextAudioUrl: string | null;
  pronunciationAudioUrl: string | null;
}

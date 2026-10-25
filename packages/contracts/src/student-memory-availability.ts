import { z } from 'zod';

/** Aggregate selection only. Stored status and pending work are separate projections.
 * Coverage counts describe references, not pedagogical completeness or mastery. */
export const studentMemoryAvailabilitySchema = z
  .object({
    state: z.enum(['absent', 'available', 'repair_required', 'repository_unavailable']),
    reason: z.enum([
      'no_established_snapshot',
      'verified_lineage',
      'established_history_ineligible',
      'repository_unavailable',
    ]),
    lessonReferenceCount: z.number().int().nonnegative(),
    homeworkReferenceCount: z.number().int().nonnegative(),
  })
  .strict();

export type StudentMemoryAvailability = z.infer<typeof studentMemoryAvailabilitySchema>;

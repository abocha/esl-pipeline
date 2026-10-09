import type { StudentMemoryAvailability } from '@esl-pipeline/contracts';

import {
  getStudentMemorySnapshotSelection,
  type StudentMemorySnapshotSelection,
} from '../domain/student-memory-snapshot-repository.js';
import { logger } from '../infrastructure/logger.js';

export const unavailableStudentMemory: StudentMemoryAvailability = {
  state: 'repository_unavailable',
  reason: 'repository_unavailable',
  lessonReferenceCount: 0,
  homeworkReferenceCount: 0,
};

/** Inspection remains read-only, and an outage never masquerades as first bootstrap. */
export async function loadStudentMemorySelection(
  studentId: string,
  select: typeof getStudentMemorySnapshotSelection = getStudentMemorySnapshotSelection,
): Promise<StudentMemorySnapshotSelection> {
  try {
    return await select(studentId);
  } catch {
    logger.warn('Student-memory availability repository read failed', {
      event: 'student_memory_availability_unavailable',
    });
    return { snapshot: null, availability: { ...unavailableStudentMemory } };
  }
}

export function describeStudentMemoryAvailability(availability: StudentMemoryAvailability): string {
  switch (availability.state) {
    case 'repair_required':
      return 'Stored long-term student-memory history is ineligible and requires explicit repair. Recent observations do not restore established history.';
    case 'repository_unavailable':
      return 'Student-memory snapshot retrieval was unavailable. Treat this memory layer as unknown, not empty.';
    case 'absent':
      return 'No established long-term student-memory snapshot available yet.';
    case 'available':
      return 'Verified long-term student-memory snapshot available; reference counts do not establish complete teaching history.';
  }
}

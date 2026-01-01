import { logger } from '../infrastructure/logger.js';
import { getStudentProfilesFromOrchestrator } from '../infrastructure/orchestrator-service.js';
import { deriveStudentId } from '../domain/student-utils.js';

export interface StudentOption {
  id: string;
  name: string;
}

export interface StudentProfilesResponse {
  students: StudentOption[];
}

export async function getStudentProfiles(): Promise<StudentProfilesResponse> {
  try {
    const profiles = await getStudentProfilesFromOrchestrator();
    const students = profiles
      .map((profile) => {
        const name = typeof profile.student === 'string' ? profile.student.trim() : '';
        if (!name) return null;
        return {
          id: deriveStudentId(name),
          name,
        };
      })
      .filter((entry): entry is StudentOption => entry !== null);

    return { students };
  } catch (error) {
    logger.warn('Failed to load student profiles from orchestrator', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { students: [] };
  }
}

import { logger } from '../infrastructure/logger.js';
import { listStudentProfiles } from './student-profiles-store.js';

export interface StudentOption {
  id: string;
  name: string;
  profileId?: string | null;
}

export interface StudentProfilesResponse {
  students: StudentOption[];
}

export async function getStudentProfiles(): Promise<StudentProfilesResponse> {
  try {
    const result = await listStudentProfiles({ limit: 500 });
    return {
      students: result.items.map((profile) => ({
        id: profile.id,
        name: profile.student,
        profileId: profile.profileId ?? null,
      })),
    };
  } catch (error) {
    logger.warn('Failed to load student profiles', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { students: [] };
  }
}

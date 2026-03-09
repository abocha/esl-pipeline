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
  const result = await listStudentProfiles({ limit: 500 });
  return {
    students: result.items.map((profile) => ({
      id: profile.id,
      name: profile.student,
      profileId: profile.profileId ?? null,
    })),
  };
}

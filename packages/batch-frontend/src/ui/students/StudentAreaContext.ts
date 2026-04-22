import { useOutletContext } from 'react-router-dom';

import type { StudentProfile } from '../../utils/api';

export interface StudentAreaContextValue {
  student: StudentProfile | null;
  studentId: string;
  studentLoading: boolean;
  studentError: string | null;
  refreshStudent: () => Promise<void>;
}

export function useStudentAreaContext(): StudentAreaContextValue {
  return useOutletContext<StudentAreaContextValue>();
}

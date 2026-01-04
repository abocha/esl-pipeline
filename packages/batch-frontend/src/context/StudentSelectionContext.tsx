import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { StudentProfile } from '../utils/api';

export interface StudentSelectionContextValue {
  selectedStudent: StudentProfile | null;
  setSelectedStudent: (student: StudentProfile | null) => void;
  updateSelectedStudent: (patch: Partial<StudentProfile>) => void;
}

const defaultContext: StudentSelectionContextValue = {
  selectedStudent: null,
  setSelectedStudent: () => {},
  updateSelectedStudent: () => {},
};

const StudentSelectionContext = createContext<StudentSelectionContextValue | null>(null);

export function StudentSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile | null>(null);

  const updateSelectedStudent = useCallback((patch: Partial<StudentProfile>) => {
    setSelectedStudent((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const value = useMemo(
    () => ({
      selectedStudent,
      setSelectedStudent,
      updateSelectedStudent,
    }),
    [selectedStudent, updateSelectedStudent],
  );

  return <StudentSelectionContext.Provider value={value}>{children}</StudentSelectionContext.Provider>;
}

export function useStudentSelection(): StudentSelectionContextValue {
  return useContext(StudentSelectionContext) ?? defaultContext;
}

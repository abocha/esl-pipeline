import { createContext, useContext, useLayoutEffect } from 'react';
export interface StudentEdits {
  dirty: boolean;
  busy?: boolean;
  save?: () => Promise<boolean>;
  discard: () => void;
}
export const StudentWorkspaceContext = createContext({
  version: 0,
  refresh: () => {},
  confirmLeave: async () => true,
  registerEdits: (_edits: StudentEdits | null) => {},
});
export const useStudentDirectoryRefresh = () => useContext(StudentWorkspaceContext);
export function useStudentPageEdits(edits: StudentEdits) {
  const { registerEdits } = useContext(StudentWorkspaceContext);
  // Refresh registration before the shared router blocker reads it in its passive effect.
  useLayoutEffect(() => {
    registerEdits(edits);
    return () => registerEdits(null);
  }, [registerEdits, edits]);
}

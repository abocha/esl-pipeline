import { createContext, useContext, useEffect } from 'react';

export type NavigationGuard = () => Promise<boolean>;
export type NavigationGuardRegistration = (guard: NavigationGuard | null) => void;

export const AssignmentNavigationGuardContext = createContext<NavigationGuardRegistration | null>(
  null,
);

export function useAssignmentNavigationGuard(guard: NavigationGuard): void {
  const register = useContext(AssignmentNavigationGuardContext);
  useEffect(() => {
    register?.(guard);
    return () => register?.(null);
  }, [guard, register]);
}

import { createContext, type ReactNode, useContext } from 'react';

const StudioV2Context = createContext(false);

// Presentation selection only. Authentication, workspace scope and durable state
// remain owned by the existing application providers and backend controllers.
export function StudioV2Provider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <StudioV2Context.Provider value={enabled}>{children}</StudioV2Context.Provider>;
}

export function useStudioV2() {
  return useContext(StudioV2Context);
}

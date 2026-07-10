import type React from 'react';

import { SupportDetails } from '../system/SupportDetails';

export interface AssignmentSupportProps {
  children: React.ReactNode;
}

export function AssignmentSupport({ children }: AssignmentSupportProps) {
  return (
    <SupportDetails summary="Support details">
      <p>
        Recovery, rerun, provider, quota, and provenance controls live here so the main assignment
        flow stays focused.
      </p>
      {children}
    </SupportDetails>
  );
}

import type React from 'react';

import { SupportDetails } from '../system/SupportDetails';

export interface AssignmentSupportProps {
  children: React.ReactNode;
}

export function AssignmentSupport({ children }: AssignmentSupportProps) {
  return (
    <SupportDetails summary="Support details">
      <p>Provider, quota, provenance, identifiers, and diagnostic details for this assignment.</p>
      {children}
    </SupportDetails>
  );
}

import { Sparkles } from 'lucide-react';

import { ProductNotice } from '../../system/ProductNotice';
import type { FocusedStepProps } from '../assignment-step-props';

export function CreateAssignmentStep({ children }: FocusedStepProps) {
  return (
    <div className="assignment-step assignment-step--create">
      <ProductNotice tone="info" title="A draft is never shared automatically" icon={<Sparkles />}>
        Generate, edit, and validate the assignment here. You will review the exact student-facing
        version in the next step before sharing.
      </ProductNotice>
      {children}
    </div>
  );
}

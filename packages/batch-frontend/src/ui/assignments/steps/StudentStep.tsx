import { ShieldCheck } from 'lucide-react';

import { ProductNotice } from '../../system/ProductNotice';
import type { FocusedStepProps } from '../assignment-step-props';

export function StudentStep({ children }: FocusedStepProps) {
  return (
    <div className="assignment-step assignment-step--student">
      {children}
      <ProductNotice tone="info" title="Learner context stays connected" icon={<ShieldCheck />}>
        The selected student’s approved learning profile and teaching memory are included when the
        assignment is created. You can review that context before generation.
      </ProductNotice>
    </div>
  );
}

import { Send } from 'lucide-react';

import { ProductNotice } from '../../system/ProductNotice';
import type { FocusedStepProps } from '../assignment-step-props';

export function ReviewShareStep({ children }: FocusedStepProps) {
  return (
    <div className="assignment-step assignment-step--review">
      <ProductNotice
        tone="success"
        title="You choose exactly what the student receives"
        icon={<Send />}
      >
        Preview the current assignment, make any final edits, and share only when it looks right.
        Returning to an earlier step keeps your work.
      </ProductNotice>
      {children}
    </div>
  );
}

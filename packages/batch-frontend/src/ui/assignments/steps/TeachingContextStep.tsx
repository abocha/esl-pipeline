import { BookOpenCheck } from 'lucide-react';

import { ProductNotice } from '../../system/ProductNotice';
import type { FocusedStepProps } from '../assignment-step-props';

export function TeachingContextStep({ children }: FocusedStepProps) {
  return (
    <div className="assignment-step assignment-step--context">
      <ProductNotice
        tone="info"
        title="You stay in control of learner context"
        icon={<BookOpenCheck />}
      >
        Review what the pipeline knows, then add only the guidance that matters for this lesson.
        Nothing is shared with the student from this step.
      </ProductNotice>
      {children}
    </div>
  );
}

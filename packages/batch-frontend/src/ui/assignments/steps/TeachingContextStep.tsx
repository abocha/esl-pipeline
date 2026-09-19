import type { FocusedStepProps } from '../assignment-step-props';

export function TeachingContextStep({ children }: FocusedStepProps) {
  return <div className="assignment-step assignment-step--context">{children}</div>;
}

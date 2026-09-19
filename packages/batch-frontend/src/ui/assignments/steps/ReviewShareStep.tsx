import type { FocusedStepProps } from '../assignment-step-props';

export function ReviewShareStep({ children }: FocusedStepProps) {
  return <div className="assignment-step assignment-step--review">{children}</div>;
}

import type { FocusedStepProps } from '../assignment-step-props';

export function CreateAssignmentStep({ children }: FocusedStepProps) {
  return <div className="assignment-step assignment-step--create">{children}</div>;
}

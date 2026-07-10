import type React from 'react';

export interface FocusedStepProps {
  children: React.ReactNode;
}

export interface LessonSourceStepProps extends FocusedStepProps {
  studentSelected: boolean;
  manualSaving: boolean;
  manualError: string | null;
  transcriptReady: boolean;
  onCreateManualTranscript: (text: string, displayName?: string) => Promise<void>;
}

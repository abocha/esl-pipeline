import type React from 'react';

import type { StudentOption } from '../../utils/api';

export interface FocusedStepProps {
  children?: React.ReactNode;
}

export interface StudentStepProps extends FocusedStepProps {
  students: StudentOption[];
  selectedStudentId: string;
  selectionLocked?: boolean;
  loading?: boolean;
  error: string | null;
  onSelect: (studentId: string) => void;
}

export interface LessonSourceStepProps extends FocusedStepProps {
  studentSelected: boolean;
  manualSaving: boolean;
  manualError: string | null;
  transcriptReady: boolean;
  lessonSummary?: string | null;
  manualSource?: boolean;
  uploading?: boolean;
  sourcePrepared?: boolean;
  preparedSourceKey?: string;
  onCreateManualTranscript: (text: string, displayName?: string) => Promise<void>;
}

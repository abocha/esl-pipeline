import type {
  AssignmentSessionStage,
  GenerationProvider,
  PublishTarget,
  TtsProviderId,
  TtsStrategy,
} from '@esl-pipeline/contracts';

export type { AssignmentSessionStage };

export interface AssignmentSessionRecord {
  id: string;
  userId: string;
  studentId: string | null;
  recordingId: string | null;
  transcriptId: string | null;
  promptPackageId: string | null;
  draftId: string | null;
  currentStage: AssignmentSessionStage;
  publishTarget: PublishTarget | null;
  selectedTtsProvider: TtsProviderId | null;
  selectedTtsStrategy: TtsStrategy | null;
  selectedTtsModel: string | null;
  selectedPreset: string | null;
  selectedGenerationProvider: GenerationProvider | null;
  selectedGenerationModel: string | null;
  teacherNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

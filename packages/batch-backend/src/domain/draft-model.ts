export interface DraftRecord {
  id: string;
  promptPackageId: string;
  studentId?: string | null;
  lessonId?: string | null;
  format?: import('@esl-pipeline/contracts').AssignmentFormat;
  storageUri: string;
  workingVersion: number | null;
  contentHash: string | null;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

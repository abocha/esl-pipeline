export interface DraftRecord {
  id: string;
  promptPackageId: string;
  studentId?: string | null;
  lessonId?: string | null;
  storageUri: string;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

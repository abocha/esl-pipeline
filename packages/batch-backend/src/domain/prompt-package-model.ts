export interface PromptPackageRecord {
  id: string;
  recordingId: string;
  transcriptId: string;
  studentId?: string | null;
  profilePath?: string | null;
  resolvedProfileId?: string | null;
  resolvedProfileHash?: string | null;
  resolvedProfileRevisionId?: string | null;
  resolvedProfileUpdatedAt?: Date | null;
  resolvedTemplateId?: string | null;
  resolvedTemplateHash?: string | null;
  resolvedTemplateRevisionId?: string | null;
  resolvedTemplateUpdatedAt?: Date | null;
  templateVersion: string;
  notes?: string | null;
  storageUri: string;
  createdAt: Date;
  updatedAt: Date;
}

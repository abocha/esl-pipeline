export interface PromptPackageRecord {
  id: string;
  recordingId: string;
  transcriptId: string;
  profilePath?: string | null;
  templateVersion: string;
  notes?: string | null;
  storageUri: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DraftRecord {
  id: string;
  promptPackageId: string;
  storageUri: string;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

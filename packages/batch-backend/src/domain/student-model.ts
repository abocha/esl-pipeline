export interface StudentRecord {
  id: string;
  student: string;
  workspaceId?: string | null;
  dbId: string | null;
  pageParentId: string | null;
  colorPreset: string | null;
  voices: Record<string, string>;
  manifestPreset: string | null;
  accentPreference: string | null;
  archivedAt: Date | null;
  archivedBy: string | null;
  archiveReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StudentListResult {
  items: StudentRecord[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

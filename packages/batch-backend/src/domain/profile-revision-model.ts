export type ProfileRevisionSource = 'create' | 'update' | 'restore';

export interface ProfileRevisionRecord {
  id: string;
  profileId: string;
  content: string;
  contentHash: string;
  source: ProfileRevisionSource;
  createdAt: Date;
  createdBy: string | null;
  restoredFromRevisionId: string | null;
}

export interface ProfileRevisionListResult {
  items: ProfileRevisionRecord[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

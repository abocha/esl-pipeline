export interface ProfileRecord {
  id: string;
  label: string;
  activeRevisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileListResult {
  items: ProfileRecord[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

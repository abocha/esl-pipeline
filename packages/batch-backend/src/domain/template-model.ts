export interface TemplateRecord {
  id: string;
  label: string;
  activeRevisionId: string | null;
  isDefault?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateListResult {
  items: TemplateRecord[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

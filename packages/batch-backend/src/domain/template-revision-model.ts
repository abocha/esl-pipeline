export type TemplateRevisionSource = 'create' | 'update' | 'restore';

export interface TemplateRevisionRecord {
  id: string;
  templateId: string;
  content: string;
  contentHash: string;
  source: TemplateRevisionSource;
  createdAt: Date;
  createdBy: string | null;
  restoredFromRevisionId: string | null;
}

export interface TemplateRevisionListResult {
  items: TemplateRevisionRecord[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

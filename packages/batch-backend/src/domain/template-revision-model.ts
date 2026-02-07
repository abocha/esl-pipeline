export type TemplateRevisionSource = 'create' | 'update' | 'restore';
export type TemplateRevisionStatus = 'draft' | 'active' | 'deprecated';

export interface TemplateRevisionRecord {
  id: string;
  templateId: string;
  content: string;
  contentHash: string;
  source: TemplateRevisionSource;
  status: TemplateRevisionStatus;
  versionNumber: number;
  versionLabel: string;
  activatedAt: Date | null;
  deprecatedAt: Date | null;
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

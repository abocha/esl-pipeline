export interface AdminTemplateRevisionDto {
  id: string;
  versionLabel: string;
  contentHash: string;
  content: string;
  status: 'draft' | 'active' | 'deprecated';
  source: 'create' | 'update' | 'restore';
  createdAt: string;
  activatedAt: string | null;
  restoredFromRevisionId: string | null;
}

export interface TemplateControlPlaneDto {
  templateId: string;
  label: string;
  databasePresent: boolean;
  active: AdminTemplateRevisionDto | null;
  shipped: {
    content: string;
    contentHash: string;
    matchingRevision: AdminTemplateRevisionDto | null;
    imported: boolean;
  } | null;
  drift: 'in_sync' | 'update_available' | 'shipped_not_imported' | 'not_shipped';
}

export interface TemplateControlPlaneListDto {
  items: TemplateControlPlaneDto[];
  defaultTemplateId: string | null;
}

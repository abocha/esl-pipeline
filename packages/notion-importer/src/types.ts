export interface ImportOptions {
  mdPath: string;
  dbId?: string;
  dbName?: string;
  dataSourceId?: string;
  dataSourceName?: string;
  student?: string;
  dryRun?: boolean;
}

export interface FrontmatterShape {
  title?: string;
  student?: string;
  topic?: string | string[];
}

export interface ResolveDataSourceInput {
  dataSourceId?: string;
  dataSourceName?: string;
  dbId?: string;
  dbName?: string;
}

export interface ResolveDataSourceResult {
  dataSourceId: string;
  databaseId: string;
}

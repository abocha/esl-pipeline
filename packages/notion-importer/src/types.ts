export type ImportOptions = {
  mdPath: string;
  dbId?: string;
  dbName?: string;
  dataSourceId?: string;
  dataSourceName?: string;
  student?: string;
  dryRun?: boolean;
};

export type FrontmatterShape = {
  title?: string;
  student?: string;
  topic?: string | string[];
};

export type ResolveDataSourceInput = {
  dataSourceId?: string;
  dataSourceName?: string;
  dbId?: string;
  dbName?: string;
};

export type ResolveDataSourceResult = {
  dataSourceId: string;
  databaseId: string;
};

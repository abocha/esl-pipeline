export type ImportOptions = {
  mdPath: string;
  dbId?: string;
  dbName?: string;
  student?: string;
  dryRun?: boolean;
};

export type FrontmatterShape = {
  title?: string;
  student?: string;
  topic?: string | string[];
};

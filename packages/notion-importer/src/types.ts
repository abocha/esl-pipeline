export interface ImportOptions {
  mdPath: string;
  dbId?: string;
  dbName?: string;
  dataSourceId?: string;
  dataSourceName?: string;
  student?: string;
  dryRun?: boolean;
  /**
   * If provided, skip re-validating the markdown and reuse this result.
   * Useful when callers already performed validation upstream.
   */
  validationResult?: {
    ok: boolean;
    errors: string[];
    warnings: string[];
  };
  /**
   * Controls strictness when importer validates the markdown itself.
   * Defaults to false (warnings stay warnings).
   */
  strictValidation?: boolean;
}

export interface FrontmatterShape {
  title?: string;
  student?: string;
  topic?: string; // Always a single string (arrays will be normalized)
  icon?: string;
  cover?: string;
  properties?: Record<string, unknown>;
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

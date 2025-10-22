import { Client } from '@notionhq/client';
import type {
  DataSourceObjectResponse,
  DatabaseObjectResponse,
  PageObjectResponse,
  PartialDataSourceObjectResponse,
  PartialPageObjectResponse,
  SearchResponse
} from '@notionhq/client/build/src/api-endpoints.js';
import type { ResolveDataSourceInput, ResolveDataSourceResult } from './types.js';

type SearchResult = SearchResponse['results'][number];
type DataSourceLike = DataSourceObjectResponse | PartialDataSourceObjectResponse;
type PageLike = PageObjectResponse | PartialPageObjectResponse;

const isPage = (result: SearchResult | PageLike): result is PageLike =>
  result.object === 'page';

const extractDatabaseTitle = (database: SearchResult): string | undefined => {
  const objectType = (database as { object?: string }).object;
  if (objectType !== 'database') return undefined;
  const titleArray = (database as unknown as DatabaseObjectResponse).title;
  if (!Array.isArray(titleArray) || titleArray.length === 0) return undefined;
  const first = titleArray[0];
  if (!first || typeof first !== 'object') return undefined;
  return 'plain_text' in first ? (first.plain_text ?? undefined) : undefined;
};

const normalize = (value?: string | null) => value?.trim().toLowerCase();

export function createNotionClient() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN is required in environment');
  return new Client({ auth: token, notionVersion: '2025-09-03' });
}

type DataSourceSummary = { id: string; name?: string | null };

function pickDataSource(
  dataSources: DataSourceSummary[],
  opts: ResolveDataSourceInput
): DataSourceSummary | undefined {
  if (!dataSources.length) return undefined;
  if (opts.dataSourceName) {
    const target = normalize(opts.dataSourceName);
    return dataSources.find(ds => normalize(ds.name) === target);
  }
  return dataSources.length === 1 ? dataSources[0] : undefined;
}

async function fetchDatabaseWithSources(
  client: Client,
  databaseId: string
): Promise<{ databaseId: string; dataSources: DataSourceSummary[] }> {
  const response = (await client.databases.retrieve({
    database_id: databaseId
  })) as DatabaseObjectResponse & { data_sources?: DataSourceSummary[] };
  const dataSources = Array.isArray(response.data_sources) ? response.data_sources : [];
  return {
    databaseId: response.id,
    dataSources: dataSources.map(ds => ({ id: ds.id, name: ds.name }))
  };
}

async function findDatabaseByName(client: Client, dbName: string): Promise<string> {
  const resp = await (client.search as any)({
    query: dbName,
    filter: { value: 'database', property: 'object' }
  });
  const target = normalize(dbName);
  for (const result of resp.results) {
    const title = extractDatabaseTitle(result);
    if (title && normalize(title) === target) {
      return result.id;
    }
  }
  throw new Error(`Database not found by name: ${dbName}`);
}

export async function resolveDataSourceId(
  client: Client,
  opts: ResolveDataSourceInput
): Promise<ResolveDataSourceResult> {
  if (opts.dataSourceId) {
    try {
      const ds = (await client.dataSources.retrieve({
        data_source_id: opts.dataSourceId
      })) as DataSourceObjectResponse;
      const parent = ds.parent;
      const databaseId =
        parent?.type === 'database_id'
          ? parent.database_id
          : parent?.type === 'data_source_id'
            ? parent.database_id
            : opts.dbId;
      if (!databaseId) throw new Error('Unable to determine parent database for provided data source ID');
      return { dataSourceId: opts.dataSourceId, databaseId };
    } catch (error) {
      throw new Error(`Unable to retrieve data source ${opts.dataSourceId}: ${(error as Error).message}`);
    }
  }

  const { dbId, dbName } = opts;
  if (!dbId && !dbName) {
    throw new Error(
      'Provide --data-source-id, or supply --db-id/--db (and optionally --data-source) to resolve a data source.'
    );
  }

  const databaseId = dbId ?? (await findDatabaseByName(client, dbName!));
  const { dataSources } = await fetchDatabaseWithSources(client, databaseId);

  const chosen = pickDataSource(dataSources, opts);
  if (chosen) {
    return { dataSourceId: chosen.id, databaseId };
  }

  if (opts.dataSourceName) {
    throw new Error(
      `Data source named "${opts.dataSourceName}" not found under database ${databaseId}.`
    );
  }

  if (dataSources.length === 0) {
    throw new Error(`No data sources found for database ${databaseId}.`);
  }

  const names = dataSources
    .map(ds => (ds.name ? `"${ds.name}"` : ds.id))
    .join(', ');

  throw new Error(
    `Multiple data sources found for database ${databaseId}: ${names}. Provide --data-source-id or --data-source <name>.`
  );
}

export async function findStudentPageId(
  client: Client,
  studentName: string,
  studentsDataSourceId?: string
): Promise<string> {
  const trimmedName = studentName.trim();
  if (!trimmedName) throw new Error('Student name is required to resolve a page');

  if (studentsDataSourceId) {
    const query = await client.dataSources.query({
      data_source_id: studentsDataSourceId,
      filter: {
        property: 'Name',
        title: { equals: trimmedName }
      },
      result_type: 'page'
    });
    const pageInDb = query.results.find(isPage);
    if (pageInDb) return pageInDb.id;
  }

  const resp = await client.search({
    query: trimmedName,
    filter: { value: 'page', property: 'object' }
  });
  const page = resp.results.find(isPage);
  if (page) return page.id;

  throw new Error(`Student page not found: ${trimmedName}`);
}

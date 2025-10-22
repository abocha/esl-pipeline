import { Client } from '@notionhq/client';
import type {
  DataSourceObjectResponse,
  PageObjectResponse,
  PartialDataSourceObjectResponse,
  PartialPageObjectResponse,
  SearchResponse
} from '@notionhq/client/build/src/api-endpoints.js';

type SearchResult = SearchResponse['results'][number];
type DataSourceLike = DataSourceObjectResponse | PartialDataSourceObjectResponse;
type PageLike = PageObjectResponse | PartialPageObjectResponse;

const isDataSource = (result: SearchResult): result is DataSourceLike =>
  result.object === 'data_source';

const isPage = (result: SearchResult | PageLike): result is PageLike =>
  result.object === 'page';

const extractTitle = (dataSource: DataSourceLike): string | undefined => {
  const titleArray = 'title' in dataSource ? dataSource.title : undefined;
  if (!Array.isArray(titleArray) || titleArray.length === 0) return undefined;
  const first = titleArray[0];
  if (!first || typeof first !== 'object') return undefined;
  return 'plain_text' in first ? (first.plain_text ?? undefined) : undefined;
};

export function createNotionClient() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN is required in environment');
  return new Client({ auth: token });
}

export async function resolveDatabaseId(client: Client, dbId?: string, dbName?: string): Promise<string> {
  if (dbId) return dbId;
  if (!dbName) throw new Error('Provide --db-id or --db "Database Name"');

  const resp = await client.search({
    query: dbName,
    filter: { value: 'data_source', property: 'object' }
  });

  const match = resp.results.find(result => {
    if (!isDataSource(result)) return false;
    const title = extractTitle(result);
    return title ? title.toLowerCase() === dbName.toLowerCase() : false;
  });

  if (match && isDataSource(match)) {
    return match.id;
  }

  const fallback = resp.results.find(isDataSource);
  if (fallback) return fallback.id;

  throw new Error(`Database not found by name: ${dbName}`);
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

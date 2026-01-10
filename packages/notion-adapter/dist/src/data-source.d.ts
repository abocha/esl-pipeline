import type { Client } from '@notionhq/client';
import type { ResolveDataSourceInput, ResolveDataSourceResult } from './types.js';
export declare function resolveDataSourceId(client: Client, opts: ResolveDataSourceInput): Promise<ResolveDataSourceResult>;
export declare function findStudentPageId(client: Client, studentName: string, studentsDataSourceId?: string): Promise<string>;
export declare function resolveStudentId(client: Client, studentName: string): Promise<string>;

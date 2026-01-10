import type { CreatePageParameters } from '@notionhq/client/build/src/api-endpoints.js';
import type { FrontmatterShape } from './types.js';
type NotionDatabaseProperties = Record<string, unknown>;
export declare function buildBaseProperties(title: string, fm: FrontmatterShape): NonNullable<CreatePageParameters['properties']>;
export declare function assertKnownProperties(properties: NonNullable<CreatePageParameters['properties']>, databaseProperties: NotionDatabaseProperties | null): void;
export declare function getTopicPropertyType(databaseProperties: NotionDatabaseProperties | null): string | undefined;
export declare function applyTopicProperty(properties: NonNullable<CreatePageParameters['properties']>, topic: string | undefined, topicPropType: string | undefined): void;
export {};

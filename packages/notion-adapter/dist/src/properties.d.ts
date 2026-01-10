import type { CreatePageParameters } from '@notionhq/client/build/src/api-endpoints.js';
import type { FrontmatterShape } from './types.js';
type NotionDatabaseProperties = Record<string, unknown>;
type PropertiesPayload = NonNullable<CreatePageParameters['properties']>;
export declare function buildBaseProperties(title: string, fm: FrontmatterShape): PropertiesPayload;
export declare function assertKnownProperties(properties: PropertiesPayload, databaseProperties: NotionDatabaseProperties | null): void;
export declare function findTitlePropertyName(databaseProperties: NotionDatabaseProperties | null, fallback?: string): string;
export declare function buildTitleProperty(title: string, titlePropertyName: string): PropertiesPayload;
export declare function mapFrontmatterProperties(fmProperties: Record<string, unknown> | undefined, databaseProperties: NotionDatabaseProperties | null, options?: {
    skipKeys?: string[];
}): PropertiesPayload;
export declare function getTopicPropertyType(databaseProperties: NotionDatabaseProperties | null): string | undefined;
export declare function applyTopicProperty(properties: NonNullable<CreatePageParameters['properties']>, topic: string | undefined, topicPropType: string | undefined): void;
export {};

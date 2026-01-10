import type { CreatePageParameters } from '@notionhq/client/build/src/api-endpoints.js';

import { ValidationError } from '@esl-pipeline/contracts';

import type { FrontmatterShape } from './types.js';

type NotionDatabaseProperties = Record<string, unknown>;

export function buildBaseProperties(
  title: string,
  fm: FrontmatterShape,
): NonNullable<CreatePageParameters['properties']> {
  const properties: NonNullable<CreatePageParameters['properties']> = {
    Name: { title: [{ type: 'text', text: { content: title } }] },
  };

  if (fm.properties) {
    for (const [key, value] of Object.entries(fm.properties)) {
      if (value === null || value === undefined || value === '') continue;
      if (key.trim().toLowerCase() === 'topic') continue;

      if (key === 'Status') {
        properties[key] = { status: { name: String(value) } };
      } else if (key === 'Audio' || String(value).startsWith('http')) {
        properties[key] = { url: String(value) };
      } else {
        properties[key] = { rich_text: [{ type: 'text', text: { content: String(value) } }] };
      }
    }
  }

  return properties;
}

export function assertKnownProperties(
  properties: NonNullable<CreatePageParameters['properties']>,
  databaseProperties: NotionDatabaseProperties | null,
): void {
  if (!databaseProperties) return;

  const propertiesEntries = Object.entries(databaseProperties);
  const dbPropertyNames = new Set(propertiesEntries.map(([name]) => name.trim().toLowerCase()));
  const unknownProps = Object.keys(properties)
    .filter((key) => key.toLowerCase() !== 'name')
    .filter((key) => !dbPropertyNames.has(key.trim().toLowerCase()));

  if (unknownProps.length === 0) return;

  const available = [...dbPropertyNames].join(', ') || '(none)';
  throw new ValidationError(
    `Unknown Notion properties in frontmatter: ${unknownProps.join(
      ', ',
    )}. Available properties: ${available}`,
  );
}

export function getTopicPropertyType(
  databaseProperties: NotionDatabaseProperties | null,
): string | undefined {
  if (!databaseProperties) return undefined;

  const topicEntry = Object.entries(databaseProperties).find(
    ([name]) => name.trim().toLowerCase() === 'topic',
  );
  const topicProp = topicEntry?.[1];
  if (topicProp && typeof topicProp === 'object' && 'type' in topicProp) {
    const type = (topicProp as { type?: unknown }).type;
    return typeof type === 'string' ? type : undefined;
  }
  return undefined;
}

export function applyTopicProperty(
  properties: NonNullable<CreatePageParameters['properties']>,
  topic: string | undefined,
  topicPropType: string | undefined,
): void {
  if (!topic) return;

  const defaultToMultiSelect = !topicPropType || topicPropType === 'multi_select';
  if (defaultToMultiSelect) {
    const topics = topic
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
    properties['Topic'] = { multi_select: topics };
  } else {
    properties['Topic'] = { rich_text: [{ type: 'text', text: { content: topic } }] };
  }
}

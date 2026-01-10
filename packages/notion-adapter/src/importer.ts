import type {
  CreatePageParameters,
  CreatePageResponse,
} from '@notionhq/client/build/src/api-endpoints.js';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import matter from 'gray-matter';

import { ValidationError, noopLogger } from '@esl-pipeline/contracts';
import { validateMarkdownFile } from '@esl-pipeline/md-validator';

import { chunk } from './chunk.js';
import { createNotionClient } from './client.js';
import { resolveDataSourceId, resolveStudentId } from './data-source.js';
import { mdToBlocks } from './blocks/mdToBlocks.js';
import {
  applyTopicProperty,
  buildBaseProperties,
  buildTitleProperty,
  findTitlePropertyName,
  getTopicPropertyType,
  mapFrontmatterProperties,
} from './properties.js';
import { withRetry } from './retry.js';
import type { FrontmatterShape, ImportOptions } from './types.js';

interface ValidationSnapshot {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const MAX_BLOCKS_PER_REQUEST = 50;

function extractLegacyFence(input: string): string {
  const lines = input.split('\n');
  const opener = lines[0] ?? '';
  if (!opener.startsWith('```')) {
    throw new ValidationError('Legacy fenced markdown must start with ``` at byte 0.');
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? '').trim() === '```') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    throw new ValidationError('Legacy fenced markdown must include a closing ``` fence.');
  }

  const after = lines.slice(closingIndex + 1);
  const hasExtraContent = after.some((line) => line.trim().length > 0);
  if (hasExtraContent) {
    throw new ValidationError('Legacy fenced markdown must not include content outside the fence.');
  }

  return lines.slice(1, closingIndex).join('\n');
}

function resolveSource(input: string): string {
  if (input.startsWith('---')) return input;
  if (input.startsWith('```')) return extractLegacyFence(input);
  if (input.startsWith('\uFEFF')) {
    throw new ValidationError('Frontmatter must start at byte 0 (no BOM).');
  }
  throw new ValidationError('Expected YAML frontmatter at byte 0 or a legacy fenced block.');
}

export async function runImport(opts: ImportOptions) {
  const rawMd = await readFile(opts.mdPath, 'utf8');
  const logger = opts.logger ?? noopLogger;

  // --- Step 1: validate programmatically (fail fast) ---
  const validation: ValidationSnapshot =
    opts.validationResult ??
    (await validateMarkdownFile(opts.mdPath, {
      strict: opts.strictValidation ?? false,
      content: rawMd,
    }));
  const v = validation;
  if (!v.ok) {
    const msg = ['Validation failed:', ...v.errors.map((e: string) => `- ${e}`)].join('\n');
    throw new ValidationError(msg);
  }

  const source = resolveSource(rawMd);
  const parsed = matter(source);
  const blockContent = parsed.content.trim();

  // --- Step 2: get front matter from content ---
  const fm = (parsed.data ?? {}) as FrontmatterShape;
  const title = fm.title ?? basename(opts.mdPath);
  // Normalize topic: if array, join with commas; always treat as single string
  const topic = Array.isArray(fm.topic) ? fm.topic.join(', ') : fm.topic;
  const studentName = (opts.student ?? fm.student ?? '').trim();

  // --- Step 3: properties payload ---
  let properties = buildBaseProperties(title, fm);

  // --- Step 4: blocks mapping ---
  const children = mdToBlocks(blockContent);

  // --- Step 5: dry run ---
  if (opts.dryRun) {
    // Add student relation for dry-run if student name exists
    if (studentName) {
      properties['Student'] = { relation: [{ id: 'dry-run-student-placeholder' }] };
    }

    const dryRunOutput = {
      dataSourceId: opts.dataSourceId ?? opts.dbId ?? 'dry-run-placeholder',
      propertiesPreview: properties,
      iconPreview: fm.icon,
      coverPreview: fm.cover,
      blocksPreview: children.map((b) => b.type),
      totalBlocks: children.length,
      studentLinked: Boolean(studentName),
    };
    return {
      page_id: undefined,
      url: undefined,
      ...dryRunOutput,
    };
  }

  // --- Step 6: Notion client / targets (only for real runs) ---
  const client = createNotionClient();
  const { dataSourceId, databaseId } = await resolveDataSourceId(client, {
    dataSourceId: opts.dataSourceId,
    dataSourceName: opts.dataSourceName,
    dbId: opts.dbId,
    dbName: opts.dbName,
  });
  const database = await withRetry(
    () =>
      client.databases.retrieve({
        database_id: databaseId,
      }),
    'databases.retrieve',
  );
  const rawDatabaseProperties = (() => {
    if (!database || typeof database !== 'object') return null;
    if (!('properties' in database)) return null;
    const props = (database as { properties?: unknown }).properties;
    if (!props || typeof props !== 'object') return null;
    return props as Record<string, unknown>;
  })();
  const topicPropTypeString = getTopicPropertyType(rawDatabaseProperties);
  if (rawDatabaseProperties) {
    const titlePropertyName = findTitlePropertyName(rawDatabaseProperties);
    properties = buildTitleProperty(title, titlePropertyName);
    const mapped = mapFrontmatterProperties(fm.properties, rawDatabaseProperties, {
      skipKeys: [titlePropertyName, 'topic'],
    });
    Object.assign(properties, mapped);
  }
  applyTopicProperty(properties, topic, topicPropTypeString);
  let studentPageId: string | undefined;
  if (studentName) {
    try {
      studentPageId = await resolveStudentId(client, studentName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.log({
        level: 'warn',
        message: 'Notion student link failed; continuing without linking student.',
        detail: { student: studentName, error: message },
        stage: 'import',
      });
    }
  }

  // Add student relation if resolved
  if (studentPageId) {
    properties['Student'] = { relation: [{ id: studentPageId }] };
  }

  // --- Step 7: create ---
  const parent = { data_source_id: dataSourceId };

  const pageCreatePayload: CreatePageParameters = {
    parent,
    properties,
  };

  if (fm.icon) {
    pageCreatePayload.icon = { type: 'emoji', emoji: fm.icon };
  }
  if (fm.cover) {
    pageCreatePayload.cover = { type: 'external', external: { url: fm.cover } };
  }

  let page: CreatePageResponse;
  if (children.length <= MAX_BLOCKS_PER_REQUEST) {
    page = await withRetry(
      () =>
        client.pages.create({
          ...pageCreatePayload,
          children,
        }),
      'pages.create',
    );
  } else {
    page = await withRetry(() => client.pages.create(pageCreatePayload), 'pages.create');
    const chunks = chunk(children, MAX_BLOCKS_PER_REQUEST);
    for (const batch of chunks) {
      await withRetry(
        () =>
          client.blocks.children.append({
            block_id: page.id,
            children: batch,
          }),
        'blocks.children.append',
      );
    }
  }

  return {
    page_id: page.id,
    url: 'url' in page && typeof page.url === 'string' ? page.url : undefined,
    studentLinked: Boolean(studentPageId),
  };
}

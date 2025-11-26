import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { ValidationError } from '@esl-pipeline/contracts';
import { extractFrontmatter } from '@esl-pipeline/md-extractor';
import { validateMarkdownFile } from '@esl-pipeline/md-validator';

import { chunk } from './chunk.js';
import { mdToBlocks } from './mdToBlocks.js';
import { createNotionClient, resolveDataSourceId, resolveStudentId } from './notion.js';
import { withRetry } from './retry.js';
import type { FrontmatterShape, ImportOptions } from './types.js';

// Notion SDK types evolve frequently; use loose types to remain forward-compatible.
type CreatePageParameters = any;
type CreatePageResponse = any;
type DatabaseObjectResponse = any;

interface ValidationSnapshot {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export type { ImportOptions, FrontmatterShape } from './types.js';

const MAX_BLOCKS_PER_REQUEST = 50;

export async function runImport(opts: ImportOptions) {
  const rawMd = await readFile(opts.mdPath, 'utf8');

  // --- Step 1: validate programmatically (fail fast) ---
  const validation: ValidationSnapshot =
    opts.validationResult ??
    (await validateMarkdownFile(opts.mdPath, { strict: opts.strictValidation ?? false }));
  const v = validation;
  if (!v.ok) {
    const msg = ['Validation failed:', ...v.errors.map((e: string) => `- ${e}`)].join('\n');
    throw new ValidationError(msg);
  }

  // --- Step 2: extract code block content (like validator does) ---
  const blockMatch = rawMd.match(/```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/m);
  if (!blockMatch) {
    throw new ValidationError(
      'No fenced code block found. Output must be inside a single triple-backtick block.',
    );
  }
  const blockContent = blockMatch[2]?.trim() ?? '';

  // --- Step 3: get front matter from block content ---
  const fm = (extractFrontmatter(blockContent) ?? {}) as FrontmatterShape;
  const title = fm.title ?? basename(opts.mdPath);
  // Normalize topic: if array, join with commas; always treat as single string
  const topic = Array.isArray(fm.topic) ? fm.topic.join(', ') : fm.topic;
  const studentName = (opts.student ?? fm.student ?? '').trim();

  // --- Step 4: properties payload ---
  const properties: NonNullable<CreatePageParameters['properties']> = {
    Name: { title: [{ type: 'text', text: { content: title } }] },
  };
  // Merge extra properties from frontmatter
  if (fm.properties) {
    for (const [key, value] of Object.entries(fm.properties)) {
      if (value === null || value === undefined || value === '') continue;
      if (key.trim().toLowerCase() === 'topic') continue; // topic handled explicitly above

      if (key === 'Status') {
        properties[key] = { status: { name: String(value) } }; // or select
      } else if (key === 'Audio' || String(value).startsWith('http')) {
        properties[key] = { url: String(value) };
      } else {
        // Default to rich_text
        properties[key] = { rich_text: [{ type: 'text', text: { content: String(value) } }] };
      }
    }
  }

  // --- Step 5: blocks mapping ---
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
  const propertiesEntries = Object.entries((database as DatabaseObjectResponse).properties ?? {});
  const dbPropertyNames = new Set(propertiesEntries.map(([name]) => name.trim().toLowerCase()));

  // Validate that all requested properties exist in the target database
  const unknownProps = Object.keys(properties)
    .filter((key) => key.toLowerCase() !== 'name')
    .filter((key) => !dbPropertyNames.has(key.trim().toLowerCase()));
  if (unknownProps.length > 0) {
    const available = [...dbPropertyNames].join(', ') || '(none)';
    throw new ValidationError(
      `Unknown Notion properties in frontmatter: ${unknownProps.join(
        ', ',
      )}. Available properties: ${available}`,
    );
  }
  const topicEntry = propertiesEntries.find(([name]) => name.trim().toLowerCase() === 'topic');
  const topicPropType = topicEntry ? (topicEntry[1] as any)?.type : undefined;
  if (topic) {
    const defaultToMultiSelect = !topicPropType || topicPropType === 'multi_select';
    if (defaultToMultiSelect) {
      const topics = topic
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .map((name) => ({ name }));
      properties['Topic'] = { multi_select: topics };
    } else {
      properties['Topic'] = { rich_text: [{ type: 'text', text: { content: topic } }] };
    }
    console.log('[notion-importer] Topic property payload', properties['Topic']);
  }
  let studentPageId: string | undefined;
  if (studentName) {
    try {
      studentPageId = await resolveStudentId(client, studentName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[notion-importer] Continuing without linking student "${studentName}": ${message}`,
      );
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
    url: (page as any).url as string | undefined,
    studentLinked: Boolean(studentPageId),
  };
}
// @ts-nocheck

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

export type { ImportOptions, FrontmatterShape } from './types.js';

const MAX_BLOCKS_PER_REQUEST = 50;

export async function runImport(opts: ImportOptions) {
  const rawMd = await readFile(opts.mdPath, 'utf8');

  // --- Step 1: validate programmatically (fail fast) ---
  const v = await validateMarkdownFile(opts.mdPath, { strict: true });
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
  const topics = Array.isArray(fm.topic) ? fm.topic : fm.topic ? [fm.topic] : [];
  const studentName = (opts.student ?? fm.student ?? '').trim();

  // --- Step 4: properties payload ---
  const properties: Record<string, any> = {
    Name: { title: [{ type: 'text', text: { content: title } }] },
  };
  if (topics.length > 0) {
    properties['Topic'] = { multi_select: topics.map((t: string) => ({ name: t })) };
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
  const { dataSourceId } = await resolveDataSourceId(client, {
    dataSourceId: opts.dataSourceId,
    dataSourceName: opts.dataSourceName,
    dbId: opts.dbId,
    dbName: opts.dbName,
  });
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

  let page: any;
  if (children.length <= MAX_BLOCKS_PER_REQUEST) {
    page = await withRetry(
      () =>
        client.pages.create({
          parent,
          properties: properties as any,
          children,
        }),
      'pages.create',
    );
  } else {
    page = await withRetry(
      () =>
        client.pages.create({
          parent,
          properties: properties as any,
        }),
      'pages.create',
    );
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

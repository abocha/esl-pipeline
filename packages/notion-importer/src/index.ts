import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Client } from '@notionhq/client';
import { createNotionClient, findStudentPageId, resolveDatabaseId } from './notion.js';
import { mdToBlocks } from './mdToBlocks.js';
import { extractFrontmatter } from '@esl-pipeline/md-extractor';
import type { ImportOptions, FrontmatterShape } from './types.js';

export async function runImport(opts: ImportOptions) {
  const md = await readFile(opts.mdPath, 'utf8');

  // --- Step 1: validate via CLI (fail fast) ---
  // Prefer programmatic later; for now call the CLI if available.
  await validateWithCli(opts.mdPath);

  // --- Step 2: get front matter ---
  const fm = (extractFrontmatter(md) ?? {}) as FrontmatterShape;
  const title = fm.title ?? basename(opts.mdPath);
  const topics = Array.isArray(fm.topic) ? fm.topic : (fm.topic ? [fm.topic] : []);
  const studentName = (opts.student ?? fm.student ?? '').trim();

  // --- Step 3: Notion client / targets ---
  const client = createNotionClient();
  const dbId = await resolveDatabaseId(client, opts.dbId, opts.dbName);
  const studentsDbId = process.env.STUDENTS_DB_ID;
  const studentPageId = studentName ? await findStudentPageId(client, studentName, studentsDbId) : undefined;

  // --- Step 4: properties payload ---
  const properties: any = {
    'Name': { title: [{ type: 'text', text: { content: title } }] }
  };
  if (studentPageId) {
    properties['Student'] = { relation: [{ id: studentPageId }] };
  }
  if (topics.length) {
    properties['Topic'] = { multi_select: topics.map(t => ({ name: t })) };
  }

  // --- Step 5: blocks mapping ---
  const children = mdToBlocks(md);

  // --- Step 6: create ---
  if (opts.dryRun) {
    return {
      dryRun: true,
      dbId,
      properties,
      blocksPreview: children.slice(0, 5).map(b => b.type),
      totalBlocks: children.length
    };
  }

  const page = await client.pages.create({
    parent: { data_source_id: dbId },
    properties,
    children
  });

  return {
    page_id: page.id,
    url: (page as any).url as string | undefined
  };
}

/** Temp shim: run validator CLI; later replace with programmatic import */
async function validateWithCli(mdPath: string) {
  try {
    const { execa } = await import('node:child_process' as any); // typesafe import not needed for runtime
  } catch {
    // Node 20+ doesn't have execa; we'll use spawnSync from child_process
  }
  const cp = await import('node:child_process');
  const { spawn } = cp as any;
  // Run the validator CLI: packages/md-validator/dist/index.js <file> --strict
  await new Promise<void>((resolve, reject) => {
    const p = spawn('node', ['packages/md-validator/dist/index.js', mdPath, '--strict'], { stdio: 'inherit' });
    p.on('exit', (code: number) => (code === 0 ? resolve() : reject(new Error(`md-validator failed: ${code}`))));
  });
}

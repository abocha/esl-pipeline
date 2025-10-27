#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { addOrReplaceAudioUnderStudyText } from '../src/index.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadEnv();
const repoEnvPath = resolve(moduleDir, '../../../.env');
if (existsSync(repoEnvPath)) {
  loadEnv({ path: repoEnvPath, override: false });
}

const program = new Command();

program
  .name('notion-add-audio')
  .description('Add or replace audio under the study-text toggle on a Notion page')
  .requiredOption('--page-id <pageId>', 'Notion page ID')
  .requiredOption('--url <url>', 'Audio URL to add')
  .option('--replace', 'Replace existing audio instead of appending')
  .action(async options => {
    try {
      const result = await addOrReplaceAudioUnderStudyText(options.pageId, options.url, {
        replace: options.replace,
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();

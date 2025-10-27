#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { applyHeadingPreset } from '../src/index.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
loadEnv();
const repoEnvPath = resolve(moduleDir, '../../../.env');
if (existsSync(repoEnvPath)) {
  loadEnv({ path: repoEnvPath, override: false });
}

const program = new Command()
  .name('notion-colorizer')
  .requiredOption('--page-id <id>', 'Notion page id')
  .requiredOption('--preset <name>', 'Preset name')
  .option('--presets-path <file>', 'Path to presets JSON', 'configs/presets.json')
  .action(async opts => {
    try {
      const res = await applyHeadingPreset(opts.pageId, opts.preset, opts.presetsPath);
      console.log(JSON.stringify(res, null, 2));
    } catch (e: any) {
      console.error(e?.message || String(e));
      process.exit(1);
    }
  });

program.parse();

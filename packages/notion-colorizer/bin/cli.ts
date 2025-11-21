#!/usr/bin/env node
import { Command } from 'commander';

import { applyHeadingPreset } from '../src/index.js';

interface ColorizerCliOptions {
  pageId: string;
  preset: string;
  presetsPath: string;
}

const program = new Command()
  .name('notion-colorizer')
  .requiredOption('--page-id <id>', 'Notion page id')
  .requiredOption('--preset <name>', 'Preset name')
  .option('--presets-path <file>', 'Path to presets JSON', 'configs/presets.json')
  .action(async (opts: ColorizerCliOptions) => {
    try {
      const res = await applyHeadingPreset(opts.pageId, opts.preset, opts.presetsPath);
      console.log(JSON.stringify(res, null, 2));
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
      console.error(message);
      process.exit(1);
    }
  });

program.parse();

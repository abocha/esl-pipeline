#!/usr/bin/env node
import { applyHeadingPreset } from '../src/index.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const pageId = flag('--page-id');
const preset = flag('--preset');
const presetsPath = flag('--presets-path');

if (!pageId || !preset) {
  console.error('Usage: notion-colorizer --page-id <id> --preset <name> [--presets-path presets.json]');
  process.exit(1);
}

applyHeadingPreset(pageId, preset, presetsPath)
  .then(result => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });

#!/usr/bin/env node
import { addAudioUnderStudyText } from '../src/index.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const pageId = flag('--page-id');
const url = flag('--url');
const replace = args.includes('--replace');

if (!pageId || !url) {
  console.error('Usage: notion-add-audio --page-id <id> --url <audioUrl> [--replace]');
  process.exit(1);
}

addAudioUnderStudyText(pageId, url, { replace })
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });

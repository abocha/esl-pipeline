#!/usr/bin/env node
import { uploadFile } from '../src/index.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const file = flag('--file');
const isPublic = args.includes('--public');

if (!file) {
  console.error('Usage: storage-uploader --file <path> [--public]');
  process.exit(1);
}

uploadFile(file, { backend: 's3', public: isPublic })
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });

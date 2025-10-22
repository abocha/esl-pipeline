#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  extractFrontmatter,
  extractStudyText,
  extractAnswerKey,
  extractTeacherNotes,
  extractSections,
} from '../src/index.js';

function requireArg(args: string[], flag: string): string {
  const i = args.indexOf(flag);
  if (i === -1 || !args[i + 1]) {
    console.error('Usage: md-extractor --md <file.md> --what <frontmatter|study|answer|notes|sections>');
    process.exit(1);
  }
  return args[i + 1]!;
}

async function main() {
  const args = process.argv.slice(2);
  const file = requireArg(args, '--md');
  const what = requireArg(args, '--what') as 'frontmatter'|'study'|'answer'|'notes'|'sections';

  const md = await readFile(file, 'utf8');

  switch (what) {
    case 'frontmatter':
      console.log(JSON.stringify(extractFrontmatter(md), null, 2));
      break;
    case 'study':
      console.log(JSON.stringify(extractStudyText(md), null, 2));
      break;
    case 'answer':
      console.log(extractAnswerKey(md));
      break;
    case 'notes':
      console.log(extractTeacherNotes(md));
      break;
    case 'sections':
      console.log(JSON.stringify(extractSections(md), null, 2));
      break;
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

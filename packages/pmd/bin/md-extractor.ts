#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import {
  extractAnswerKey,
  extractFrontmatter,
  extractSections,
  extractStudyText,
  extractTeacherNotes,
  parseMarkdownContext,
} from '../src/index.js';

function requireArg(args: string[], flag: string): string {
  const i = args.indexOf(flag);
  if (i === -1 || !args[i + 1]) {
    console.error(
      'Usage: md-extractor --md <file.md> --what <frontmatter|study|answer|notes|sections>',
    );
    process.exit(1);
  }
  return args[i + 1]!;
}

async function main() {
  const args = process.argv.slice(2);
  const file = requireArg(args, '--md');
  const what = requireArg(args, '--what') as
    | 'frontmatter'
    | 'study'
    | 'answer'
    | 'notes'
    | 'sections';

  const md = await readFile(file, 'utf8');
  const context = parseMarkdownContext(md);

  switch (what) {
    case 'frontmatter': {
      console.log(JSON.stringify(extractFrontmatter(context), null, 2));
      break;
    }
    case 'study': {
      console.log(JSON.stringify(extractStudyText(context), null, 2));
      break;
    }
    case 'answer': {
      console.log(extractAnswerKey(context));
      break;
    }
    case 'notes': {
      console.log(extractTeacherNotes(context));
      break;
    }
    case 'sections': {
      console.log(JSON.stringify(extractSections(context), null, 2));
      break;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

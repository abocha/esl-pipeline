import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createStaticPageHtml } from '../src/rendering.js';

interface PreviewOptions {
  md: string;
  out: string;
  title: string;
  allowRawHtml: boolean;
  showGeneratedDate: boolean;
  stickyToc: boolean;
  copyCode: boolean;
}

function printUsage(): void {
  console.log(`Usage: pnpm --filter @esl-pipeline/anytype-adapter preview -- --md <file> [--out <file>] [--title <title>] [flags]

Options:
  --md     Path to markdown file (required)
  --out    Output HTML path (default: tmp/anytype-preview.html in the repo)
  --title  Page title (default: frontmatter title if present)

Flags:
  --raw-html            Allow raw HTML from markdown
  --hide-date           Hide generated date tag in the page header
  --sticky-toc          Enable sticky table of contents
  --no-sticky-toc       Disable sticky table of contents
  --no-copy-code        Disable code-copy buttons`);
}

function parseArgs(argv: string[]): PreviewOptions | null {
  const args = [...argv];
  const options: PreviewOptions = {
    md: '',
    out: 'tmp/anytype-preview.html',
    title: '',
    allowRawHtml: false,
    showGeneratedDate: true,
    stickyToc: false,
    copyCode: true,
  };

  while (args.length > 0) {
    const token = args.shift();
    if (!token) continue;
    if (token === '--help' || token === '-h') {
      return null;
    }
    if (token === '--md') {
      options.md = args.shift() ?? '';
      continue;
    }
    if (token === '--out') {
      options.out = args.shift() ?? options.out;
      continue;
    }
    if (token === '--title') {
      options.title = args.shift() ?? options.title;
      continue;
    }
    if (token === '--raw-html') {
      options.allowRawHtml = true;
      continue;
    }
    if (token === '--hide-date') {
      options.showGeneratedDate = false;
      continue;
    }
    if (token === '--sticky-toc') {
      options.stickyToc = true;
      continue;
    }
    if (token === '--no-sticky-toc') {
      options.stickyToc = false;
      continue;
    }
    if (token === '--no-copy-code') {
      options.copyCode = false;
      continue;
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    printUsage();
    process.exit(0);
  }

  if (!options.md) {
    printUsage();
    process.exit(1);
  }

  const mdPath = await resolveInputPath(options.md);
  const outPath = resolveOutputPath(options.out);
  await ensureOutputDir(outPath);
  const markdown = await readFile(mdPath, 'utf8');
  const html = await createStaticPageHtml(markdown, options.title, {
    allowRawHtml: options.allowRawHtml,
    showGeneratedDate: options.showGeneratedDate,
    features: {
      stickyToc: options.stickyToc,
      copyCode: options.copyCode,
    },
  });
  await writeFile(outPath, html, 'utf8');
  console.log(outPath);
}

await main();

async function resolveInputPath(input: string): Promise<string> {
  if (input.startsWith('/') || /^[A-Za-z]:\\/.test(input)) {
    return input;
  }
  const cwdPath = resolve(process.cwd(), input);
  if (await pathExists(cwdPath)) return cwdPath;
  const initCwd = process.env.INIT_CWD;
  if (initCwd) {
    const initPath = resolve(initCwd, input);
    if (await pathExists(initPath)) return initPath;
  }
  return cwdPath;
}

function resolveOutputPath(output: string): string {
  if (output.startsWith('/') || /^[A-Za-z]:\\/.test(output)) {
    return output;
  }
  const initCwd = process.env.INIT_CWD;
  if (initCwd) {
    return resolve(initCwd, output);
  }
  return resolve(process.cwd(), output);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureOutputDir(outputPath: string): Promise<void> {
  const directory = dirname(outputPath);
  await mkdir(directory, { recursive: true });
}

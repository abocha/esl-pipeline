#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const packageJsonPath = path.join(repoRoot, 'package.json');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const semverRe = /^(\d+)\.(\d+)\.(\d+)$/;

function die(message) {
  console.error(`[write-release-files] error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { event: '', version: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--event') {
      args.event = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (token === '--version') {
      args.version = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (token === '-h' || token === '--help') {
      console.log(
        'Usage: node scripts/release/write-release-files.mjs --event <github-event.json> --version <X.Y.Z>',
      );
      process.exit(0);
    }
    die(`Unknown argument: ${token}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.event) die('Missing --event <path>');
  if (!semverRe.test(args.version)) {
    die(`--version must be valid semver (X.Y.Z), got: ${args.version}`);
  }

  const event = JSON.parse(readFileSync(args.event, 'utf8'));
  const pr = event.pull_request ?? null;
  const prNumber = typeof pr?.number === 'number' ? pr.number : null;
  const prTitle = typeof pr?.title === 'string' ? pr.title.trim() : 'Merged PR';
  const prUrl = typeof pr?.html_url === 'string' ? pr.html_url : '';

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  packageJson.version = args.version;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  const today = new Date().toISOString().slice(0, 10);
  const releaseHeading = `## [${args.version}] - ${today}`;
  const summaryLine =
    prNumber !== null
      ? `- Automated release from PR #${prNumber}: ${prTitle}${prUrl ? ` (${prUrl})` : ''}`
      : `- Automated release: ${prTitle}${prUrl ? ` (${prUrl})` : ''}`;

  const changelogCurrent = readFileSync(changelogPath, 'utf8');
  const insertion = `${releaseHeading}\n\n### Changed\n\n${summaryLine}\n\n`;

  const marker = '\n## [';
  const markerIndex = changelogCurrent.indexOf(marker);

  const nextChangelog =
    markerIndex === -1
      ? `${changelogCurrent.trimEnd()}\n\n${insertion}`
      : `${changelogCurrent.slice(0, markerIndex + 1)}${insertion}${changelogCurrent.slice(markerIndex + 1)}`;

  writeFileSync(changelogPath, nextChangelog, 'utf8');

  console.log(`[write-release-files] updated package.json + CHANGELOG.md for ${args.version}`);
}

main();

#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { resolveReleaseSelection } from './release-label-policy.mjs';

function die(message) {
  console.error(`[resolve-release-bump-from-pr] error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { event: '', changedFiles: '', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--event') {
      args.event = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--changed-files') {
      args.changedFiles = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (token === '-h' || token === '--help') {
      console.log(
        'Usage: node scripts/release/resolve-release-bump-from-pr.mjs --event <github-event.json> [--changed-files <json>] [--json]',
      );
      process.exit(0);
    }
    die(`Unknown argument: ${token}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.event) {
    die('Missing --event <path>');
  }

  let event;
  try {
    event = JSON.parse(readFileSync(args.event, 'utf8'));
  } catch (error) {
    die(`Unable to read event payload: ${error instanceof Error ? error.message : String(error)}`);
  }

  const labels = Array.isArray(event?.pull_request?.labels) ? event.pull_request.labels : [];
  const hasOnlyReleaseNone =
    labels.filter((label) => label?.name?.startsWith('release:')).length === 1 &&
    labels.some((label) => label?.name === 'release:none');
  if (hasOnlyReleaseNone && !args.changedFiles) {
    die('Missing --changed-files <path> for release:none');
  }

  let changedFilePayload;
  if (hasOnlyReleaseNone) {
    try {
      changedFilePayload = JSON.parse(readFileSync(args.changedFiles, 'utf8'));
    } catch (error) {
      die(
        `Unable to read changed-file payload: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let selection;
  try {
    selection = resolveReleaseSelection(labels, changedFilePayload);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }

  if (args.json) {
    console.log(JSON.stringify(selection));
    return;
  }

  console.log(selection.bump ?? 'none');
}

main();

#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import process from 'node:process';

const RELEASE_LABEL_TO_BUMP = new Map([
  ['release:major', 'major'],
  ['release:minor', 'minor'],
  ['release:patch', 'patch'],
]);

function die(message) {
  console.error(`[resolve-release-bump-from-pr] error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { event: '', json: false };
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
    if (token === '-h' || token === '--help') {
      console.log(
        'Usage: node scripts/release/resolve-release-bump-from-pr.mjs --event <github-event.json> [--json]',
      );
      process.exit(0);
    }
    die(`Unknown argument: ${token}`);
  }
  return args;
}

function normalizeLabelName(label) {
  if (typeof label === 'string') return label.trim();
  if (label && typeof label === 'object' && typeof label.name === 'string') {
    return label.name.trim();
  }
  return '';
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

  const labels = Array.isArray(event?.pull_request?.labels)
    ? event.pull_request.labels.map(normalizeLabelName).filter(Boolean)
    : [];

  const matchedLabels = labels.filter((name) => RELEASE_LABEL_TO_BUMP.has(name));

  if (matchedLabels.length !== 1) {
    const found = matchedLabels.length === 0 ? 'none' : matchedLabels.join(', ');
    die(
      `Expected exactly one release label (${Array.from(RELEASE_LABEL_TO_BUMP.keys()).join(', ')}), found: ${found}`,
    );
  }

  const releaseLabel = matchedLabels[0];
  const bump = RELEASE_LABEL_TO_BUMP.get(releaseLabel);
  if (!bump) {
    die(`Unsupported release label: ${releaseLabel}`);
  }

  if (args.json) {
    console.log(
      JSON.stringify({
        label: releaseLabel,
        bump,
      }),
    );
    return;
  }

  console.log(bump);
}

main();

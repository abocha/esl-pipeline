#!/usr/bin/env node
import process from 'node:process';

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function die(message) {
  console.error(`[compute-next-version] error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { current: '', bump: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--current') {
      args.current = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (token === '--bump') {
      args.bump = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (token === '-h' || token === '--help') {
      console.log(
        'Usage: node scripts/release/compute-next-version.mjs --current <X.Y.Z> --bump <major|minor|patch>',
      );
      process.exit(0);
    }
    die(`Unknown argument: ${token}`);
  }
  return args;
}

function main() {
  const { current, bump } = parseArgs(process.argv.slice(2));

  if (!SEMVER_RE.test(current)) {
    die(`Invalid current version "${current}"; expected X.Y.Z`);
  }
  if (!['major', 'minor', 'patch'].includes(bump)) {
    die(`Invalid bump "${bump}"; expected major|minor|patch`);
  }

  const [, majorRaw, minorRaw, patchRaw] = current.match(SEMVER_RE);
  let major = Number(majorRaw);
  let minor = Number(minorRaw);
  let patch = Number(patchRaw);

  if (bump === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  console.log(`${major}.${minor}.${patch}`);
}

main();

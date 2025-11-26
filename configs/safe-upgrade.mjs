#!/usr/bin/env node
/**
 * Safe upgrade script: bumps critical external SDKs while leaving core runtime pinned.
 *
 * It runs `pnpm up --latest` scoped to the allowlist below, then reapplies shared pins.
 * Usage: pnpm exec node configs/safe-upgrade.mjs
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const CRITICAL_ALLOWLIST = [
  // External API SDKs we want fresh
  '@notionhq/client',
  '@elevenlabs/elevenlabs-js',
  '@aws-sdk/client-s3',
  '@aws-sdk/s3-request-presigner',
  '@aws-sdk/lib-storage',
];

const STABLE_UTILS = [
  // Generally safe to bump patch/minor
  'axios',
  'remark-parse',
  'unified',
  'commander',
  'ora',
  'picocolors',
];

const EXTRA = process.env.SAFE_UPGRADE_EXTRA
  ? process.env.SAFE_UPGRADE_EXTRA.split(/\s+/).filter(Boolean)
  : [];

const MODE = process.argv.includes('--patch') ? 'patch' : 'latest';

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: root });
};

const buildScope = (pkgs) => pkgs.join(' ');

const scopeCritical = buildScope(CRITICAL_ALLOWLIST);
const scopeStable = buildScope([...STABLE_UTILS, ...EXTRA]);

const modeFlag = MODE === 'patch' ? '--latest --depth -1 --filter \"...@^\"' : '--latest';

// 1) Upgrade critical SDKs (always latest)
run(`pnpm -r up --latest ${scopeCritical}`);

// 2) Upgrade stable utilities (patch-friendly; still using latest flag due to pnpm constraints)
if (scopeStable.trim()) {
  run(`pnpm -r up --latest ${scopeStable}`);
}

// 2) Reapply shared pins to avoid drift
run('pnpm deps:pin');

console.log(
  `\nSafe upgrade complete (mode=${MODE}). Review changes, run tests, then commit.\n` +
    `Extras via SAFE_UPGRADE_EXTRA were: ${EXTRA.join(', ') || 'none'}.`,
);

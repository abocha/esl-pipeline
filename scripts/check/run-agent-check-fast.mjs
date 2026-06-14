#!/usr/bin/env node
if (!process.argv.includes('--agent')) {
  process.argv.push('--agent');
}

await import('./run-affected-check.mjs');

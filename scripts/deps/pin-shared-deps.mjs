#!/usr/bin/env node
// Align shared dependency versions across workspace packages.
// Usage: pnpm exec node scripts/deps/pin-shared-deps.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SHARED = {
  '@aws-sdk/client-s3': '^3.1010.0',
  '@aws-sdk/s3-request-presigner': '^3.1010.0',
  '@aws-sdk/lib-storage': '^3.1010.0',
  '@elevenlabs/elevenlabs-js': '^2.38.1',
  '@notionhq/client': '^5.11.1',
  commander: '^14.0.2',
  zod: '^4.1.13',
  // Frontend
  react: '^19.2.0',
  'react-dom': '^19.2.0',
  axios: '^1.13.6',
  '@tanstack/react-query': '^5.90.11',
  vite: '^8.0.0',
  '@vitejs/plugin-react': '^6.0.1',
  // Backend
  fastify: '^5.8.2',
  pg: '^8.20.0',
  ioredis: '^5.10.0',
  bullmq: '^5.70.4',
  bcrypt: '^6.0.0',
  jsonwebtoken: '^9.0.2',
};

const fields = ['dependencies', 'devDependencies'];
const packagesDir = join(process.cwd(), 'packages');

const updated = [];

for (const entry of readdirSync(packagesDir)) {
  const pkgPath = join(packagesDir, entry, 'package.json');
  if (!existsSync(pkgPath)) continue;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  let changed = false;

  for (const field of fields) {
    if (!pkg[field]) continue;
    for (const [dep, version] of Object.entries(SHARED)) {
      if (pkg[field][dep] && pkg[field][dep] !== version) {
        pkg[field][dep] = version;
        changed = true;
      }
    }
  }

  if (changed) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    updated.push(pkg.name ?? entry);
  }
}

if (updated.length === 0) {
  console.log('No packages required updates.');
} else {
  console.log(`Updated ${updated.length} package(s): ${updated.join(', ')}`);
}

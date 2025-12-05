#!/usr/bin/env node
// Align shared dependency versions across workspace packages.
// Usage: pnpm exec node configs/pin-shared-deps.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SHARED = {
  '@aws-sdk/client-s3': '^3.940.0',
  '@aws-sdk/s3-request-presigner': '^3.940.0',
  '@aws-sdk/lib-storage': '^3.940.0',
  '@elevenlabs/elevenlabs-js': '^2.25.0',
  '@notionhq/client': '^5.4.0',
  commander: '^14.0.2',
  zod: '^4.1.13',
  // Frontend
  react: '^19.2.0',
  'react-dom': '^19.2.0',
  axios: '^1.13.2',
  '@tanstack/react-query': '^5.90.11',
  vite: '^7.2.4',
  '@vitejs/plugin-react-swc': '^4.2.2',
  // Backend
  fastify: '^5.6.2',
  pg: '^8.16.3',
  ioredis: '^5.8.2',
  bullmq: '^5.65.0',
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

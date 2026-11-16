import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildCaddyValidateArgs } from './validate-caddy-config.mjs';

const caddyfile = readFileSync(new URL('../../deploy/caddy/Caddyfile', import.meta.url), 'utf8');
const productionCompose = readFileSync(
  new URL('../../docker-compose.prod.yml', import.meta.url),
  'utf8',
);

test('builds caddy validate docker args with an absolute Caddyfile bind mount', () => {
  const repoRoot = path.resolve('D:/code/esl-pipeline');
  const args = buildCaddyValidateArgs({ repoRoot });

  assert.deepEqual(args.slice(0, 3), ['run', '--rm', '-v']);
  assert.match(args[3], /deploy[\\/]caddy[\\/]Caddyfile:\/etc\/caddy\/Caddyfile:ro$/);
  assert.doesNotMatch(args[3], /\$\{PWD\}/);
  assert.equal(path.isAbsolute(args[3].split(':/etc/caddy/Caddyfile:ro')[0]), true);
  const image = productionCompose.match(/^  caddy-edge:\s*\n    image: (\S+)$/mu)?.[1];
  assert.ok(image);
  assert.deepEqual(args.slice(-5), [
    image,
    'caddy',
    'validate',
    '--config',
    '/etc/caddy/Caddyfile',
  ]);
});

test('public edge negotiates modern and fallback compression', () => {
  assert.match(caddyfile, /^\s*encode zstd gzip$/mu);
});

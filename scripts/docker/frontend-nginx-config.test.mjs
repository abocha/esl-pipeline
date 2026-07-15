import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const nginxConfig = readFileSync(
  new URL('../../packages/batch-frontend/nginx.conf', import.meta.url),
  'utf8',
);

test('frontend nginx strips only /api while preserving encoded slashes for backend routes', () => {
  assert.doesNotMatch(nginxConfig, /proxy_pass\s+http:\/\/batch-backend:8080\/;/);
  assert.match(nginxConfig, /set\s+\$backend_request_uri\s+\$request_uri;/);
  assert.match(nginxConfig, /if\s+\(\$backend_request_uri\s+~\s+\^\/api\/\(\.\*\)\$\)/);
  assert.match(nginxConfig, /set\s+\$backend_request_uri\s+\/\$1;/);
  assert.match(nginxConfig, /proxy_pass\s+http:\/\/batch-backend:8080\$backend_request_uri;/);
});

test('frontend nginx caches content-hashed assets immutably without SPA fallback', () => {
  assert.match(
    nginxConfig,
    /location \^~ \/assets\/ \{\s+try_files \$uri =404;\s+add_header Cache-Control "public, max-age=31536000, immutable" always;\s+\}/u,
  );
});

test('frontend nginx requires SPA entry HTML to revalidate', () => {
  assert.match(
    nginxConfig,
    /location = \/index\.html \{\s+add_header Cache-Control "no-cache" always;\s+\}/u,
  );
});

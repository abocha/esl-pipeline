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

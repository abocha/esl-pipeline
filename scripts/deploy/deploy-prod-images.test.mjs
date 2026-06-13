import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deployScript = readFileSync(new URL('./deploy-prod-images.sh', import.meta.url), 'utf8');

test('production deploy force-recreates caddy-edge when edge mode is enabled', () => {
  assert.match(deployScript, /recreate_edge_service\(\)/);
  assert.match(
    deployScript,
    /compose_with_env "\$PENDING_ENV" up -d --no-build --force-recreate caddy-edge/,
  );
});

test('production deploy asserts the running Caddy upstream points at the frontend 8080 port', () => {
  assert.match(deployScript, /assert_caddy_upstream_config\(\)/);
  assert.match(deployScript, /reverse_proxy batch-frontend:8080/);
  assert.match(deployScript, /run_smoke_checks\(\)[\s\S]*assert_caddy_upstream_config/);
});

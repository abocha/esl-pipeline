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

test('production deploy can load Caddy edge env from the server-local batch backend env file', () => {
  assert.match(deployScript, /load_edge_env_from_batch_backend_env_file\(\)/);
  assert.match(deployScript, /read_env_file_value\(\)/);
  assert.match(deployScript, /\$\{APP_DIR\}\/\.env\.batch-backend/);
  assert.match(deployScript, /CADDY_PUBLIC_HOSTNAME/);
  assert.match(deployScript, /CADDY_ACME_EMAIL/);
  assert.match(
    deployScript,
    /load_edge_env_from_batch_backend_env_file[\s\S]*export CADDY_PUBLIC_HOSTNAME/,
  );
  assert.match(
    deployScript,
    /load_edge_env_from_batch_backend_env_file[\s\S]*export CADDY_ACME_EMAIL/,
  );
  assert.match(
    deployScript,
    /load_edge_env_from_batch_backend_env_file[\s\S]*\[\[ -n "\$\{CADDY_PUBLIC_HOSTNAME:-\}" \]\]/,
  );
  assert.match(
    deployScript,
    /load_edge_env_from_batch_backend_env_file[\s\S]*\[\[ -n "\$\{CADDY_ACME_EMAIL:-\}" \]\]/,
  );
  assert.match(
    deployScript,
    /\[\[ -f "\$\{APP_DIR\}\/\.env\.batch-backend" \]\][\s\S]*load_edge_env_from_batch_backend_env_file[\s\S]*validate_edge_configuration/,
  );
});

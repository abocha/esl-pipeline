import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deployScript = readFileSync(new URL('./deploy-prod-images.sh', import.meta.url), 'utf8');

test('production deploy resolves remote digests and locally aliases unchanged images', () => {
  assert.match(deployScript, /remote_image_digest\(\)/);
  assert.match(deployScript, /docker buildx imagetools inspect/);
  assert.match(deployScript, /docker image tag "\$current_image" "\$requested_image"/);
  assert.match(deployScript, /prepare_image\(\)/);
});

test('production deploy persists Caddy configuration state and uses the pure planner', () => {
  assert.match(deployScript, /deploy-prod-images-plan\.sh/);
  assert.match(deployScript, /CADDY_CONFIG_DIGEST/);
  assert.match(deployScript, /sha256sum "\$\{APP_DIR\}\/deploy\/caddy\/Caddyfile"/);
  assert.match(deployScript, /build_deployment_plan/);
});

test('production deploy gates database and service work on the computed plan', () => {
  assert.match(
    deployScript,
    /if \[\[ "\$DATABASE_WORK_REQUIRED" == "true" \]\]; then[\s\S]*create_pre_migration_backup[\s\S]*run_migrations_once/,
  );
  assert.match(
    deployScript,
    /if \[\[ "\$\{#DEPLOYMENT_SERVICES\[@\]\}" -gt 0 \]\]; then[\s\S]*"\$\{DEPLOYMENT_SERVICES\[@\]\}"/,
  );
  assert.match(deployScript, /--no-deps --force-recreate "\$\{DEPLOYMENT_SERVICES\[@\]\}"/);
  assert.match(deployScript, /if \[\[ "\$INITIAL_DEPLOY" == "true" \]\]; then/);
});

test('production deploy force-recreates caddy-edge only when the plan requires it', () => {
  assert.match(deployScript, /recreate_edge_service\(\)/);
  assert.match(deployScript, /EDGE_RESTART_REQUIRED/);
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

test('production deploy requires the canonical server-local application env file for Caddy edge values', () => {
  assert.match(deployScript, /load_edge_env_from_application_env_file\(\)/);
  assert.match(deployScript, /read_env_file_value\(\)/);
  assert.match(deployScript, /\$\{APP_DIR\}\/\.env/);
  assert.doesNotMatch(deployScript, /\.env\.batch-backend/);
  assert.match(deployScript, /CADDY_PUBLIC_HOSTNAME/);
  assert.match(deployScript, /CADDY_ACME_EMAIL/);
  assert.match(
    deployScript,
    /load_edge_env_from_application_env_file[\s\S]*export CADDY_PUBLIC_HOSTNAME/,
  );
  assert.match(
    deployScript,
    /load_edge_env_from_application_env_file[\s\S]*export CADDY_ACME_EMAIL/,
  );
  assert.match(
    deployScript,
    /load_edge_env_from_application_env_file[\s\S]*\[\[ -n "\$\{CADDY_PUBLIC_HOSTNAME:-\}" \]\]/,
  );
  assert.match(
    deployScript,
    /load_edge_env_from_application_env_file[\s\S]*\[\[ -n "\$\{CADDY_ACME_EMAIL:-\}" \]\]/,
  );
  assert.match(
    deployScript,
    /\[\[ -f "\$\{APP_DIR\}\/\.env" \]\][\s\S]*load_edge_env_from_application_env_file[\s\S]*validate_edge_configuration/,
  );
});

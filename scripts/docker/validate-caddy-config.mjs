import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildCaddyValidateArgs({ repoRoot = process.cwd() } = {}) {
  const caddyfilePath = path.resolve(repoRoot, 'deploy/caddy/Caddyfile');
  return [
    'run',
    '--rm',
    '-v',
    `${caddyfilePath}:/etc/caddy/Caddyfile:ro`,
    '-e',
    'CADDY_PUBLIC_HOSTNAME',
    '-e',
    'CADDY_TRANSITION_HOSTNAME',
    '-e',
    'CADDY_TRANSITION_MODE',
    '-e',
    'CADDY_ACME_EMAIL',
    'caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0',
    'caddy',
    'validate',
    '--config',
    '/etc/caddy/Caddyfile',
  ];
}

export function validateCaddyConfig({ repoRoot = process.cwd(), env = process.env } = {}) {
  const result = spawnSync('docker', buildCaddyValidateArgs({ repoRoot }), {
    env,
    stdio: 'inherit',
  });

  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = validateCaddyConfig();
}

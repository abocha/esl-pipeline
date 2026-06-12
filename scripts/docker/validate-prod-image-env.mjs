#!/usr/bin/env node
import process from 'node:process';

const shaTagPattern = /^[^:\s]+:[0-9a-f]{40}$/;

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(value ?? '');
}

function opsBotProfileEnabled() {
  if (isTruthy(process.env.DEPLOY_INCLUDE_OPS_BOT)) return true;
  return (process.env.COMPOSE_PROFILES ?? '')
    .split(',')
    .map((value) => value.trim())
    .includes('ops-bot');
}

const required = ['BATCH_BACKEND_IMAGE', 'BATCH_FRONTEND_IMAGE'];
if (opsBotProfileEnabled()) {
  required.push('TELEGRAM_OPS_BOT_IMAGE');
}

const errors = [];
for (const name of required) {
  const value = process.env[name]?.trim();
  if (!value) {
    errors.push(`${name} is required`);
    continue;
  }
  if (!shaTagPattern.test(value)) {
    errors.push(`${name} must be an image reference tagged with a full 40-character Git SHA`);
  }
}

if (errors.length > 0) {
  console.error('Production image environment validation failed:');
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log('Production image environment is valid.');

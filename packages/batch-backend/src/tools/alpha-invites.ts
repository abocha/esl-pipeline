import { fileURLToPath } from 'node:url';

import {
  createAlphaInvite,
  listAlphaInvites,
  revokeAlphaInvite,
} from '../application/alpha-invites.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { configureHostRunPgRuntimeEnv } from '../bootstrap/pg-host-run-env.js';
import { closePgPool } from '../infrastructure/db.js';

function printUsage(): void {
  console.log(
    'Usage: node dist/tools/alpha-invites.js <create|list|revoke> [--email <email>] [--expires-days <days>] [--app-url <url>]',
  );
}

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function requiredFlag(name: string): string {
  const value = readFlag(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function handleCreate(): Promise<void> {
  const email = requiredFlag('--email');
  const expiresDays = Number.parseInt(readFlag('--expires-days') ?? '14', 10);
  if (!Number.isFinite(expiresDays) || expiresDays < 1 || expiresDays > 90) {
    throw new Error('--expires-days must be an integer between 1 and 90');
  }

  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);
  const result = await createAlphaInvite({
    email,
    expiresAt,
    appUrl: readFlag('--app-url'),
  });

  console.log(`Invite created for ${result.invite.emailNormalized}`);
  console.log(`Expires at: ${result.invite.expiresAt.toISOString()}`);
  console.log(`Token: ${result.token}`);
  if (result.url) {
    console.log(`URL: ${result.url}`);
  }
}

async function handleList(): Promise<void> {
  const invites = await listAlphaInvites();
  console.log(JSON.stringify(invites, null, 2));
}

async function handleRevoke(): Promise<void> {
  const email = requiredFlag('--email');
  const invite = await revokeAlphaInvite(email);
  if (!invite) {
    console.log('No pending invite found.');
    return;
  }
  console.log(`Revoked invite for ${invite.emailNormalized}`);
}

async function main(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-alpha-invites-tool');
  configureHostRunPgRuntimeEnv();

  const command = process.argv[2]?.trim().toLowerCase();
  switch (command) {
    case 'create':
      await handleCreate();
      break;
    case 'list':
      await handleList();
      break;
    case 'revoke':
      await handleRevoke();
      break;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePgPool();
    });
}

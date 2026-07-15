import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const libraryPath = new URL('./deploy-prod-images-plan.sh', import.meta.url).pathname.replace(
  /^\/([A-Za-z]):/u,
  (_, drive) => `/mnt/${drive.toLowerCase()}`,
);

function plan({
  currentBackend = 'backend-old',
  currentFrontend = 'frontend-old',
  currentBot = 'bot-old',
  currentCaddy = 'caddy-old',
  requestedBackend = 'backend-old',
  requestedFrontend = 'frontend-old',
  requestedBot = 'bot-old',
  requestedCaddy = 'caddy-old',
  opsBotEnabled = 'false',
  edgeEnabled = 'true',
} = {}) {
  const result = spawnSync(
    'bash',
    [
      libraryPath,
      currentBackend,
      currentFrontend,
      currentBot,
      currentCaddy,
      requestedBackend,
      requestedFrontend,
      requestedBot,
      requestedCaddy,
      opsBotEnabled,
      edgeEnabled,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const [backend, frontend, bot, caddy, database, edge, initial, services] = result.stdout
    .trim()
    .split('|');
  return { backend, frontend, bot, caddy, database, edge, initial, services };
}

test('first deployment performs database work and starts the complete enabled runtime', () => {
  const result = plan({
    currentBackend: '',
    currentFrontend: '',
    currentBot: '',
    currentCaddy: '',
    opsBotEnabled: 'true',
  });
  assert.deepEqual(result, {
    backend: 'true',
    frontend: 'true',
    bot: 'true',
    caddy: 'true',
    database: 'true',
    edge: 'true',
    initial: 'true',
    services:
      'batch-backend batch-worker transcribe-worker student-memory-worker batch-frontend telegram-ops-bot',
  });
});

test('backend-only changes restart backend workers, frontend, and edge', () => {
  const result = plan({ requestedBackend: 'backend-new' });
  assert.equal(result.database, 'true');
  assert.equal(result.initial, 'false');
  assert.equal(result.edge, 'true');
  assert.equal(
    result.services,
    'batch-backend batch-worker transcribe-worker student-memory-worker batch-frontend',
  );
});

test('frontend-only changes restart frontend and edge without database work', () => {
  const result = plan({ requestedFrontend: 'frontend-new' });
  assert.equal(result.database, 'false');
  assert.equal(result.edge, 'true');
  assert.equal(result.services, 'batch-frontend');
});

test('enabled bot-only changes restart only the bot', () => {
  const result = plan({ requestedBot: 'bot-new', opsBotEnabled: 'true' });
  assert.equal(result.bot, 'true');
  assert.equal(result.edge, 'false');
  assert.equal(result.services, 'telegram-ops-bot');
});

test('disabled bot changes do not start or restart the bot', () => {
  const result = plan({ requestedBot: 'bot-new' });
  assert.equal(result.bot, 'false');
  assert.equal(result.services, '');
});

test('Caddy-only changes recreate only the edge', () => {
  const result = plan({ requestedCaddy: 'caddy-new' });
  assert.equal(result.caddy, 'true');
  assert.equal(result.edge, 'true');
  assert.equal(result.services, '');
});

test('alias-only releases require no runtime work', () => {
  const result = plan();
  assert.deepEqual(result, {
    backend: 'false',
    frontend: 'false',
    bot: 'false',
    caddy: 'false',
    database: 'false',
    edge: 'false',
    initial: 'false',
    services: '',
  });
});

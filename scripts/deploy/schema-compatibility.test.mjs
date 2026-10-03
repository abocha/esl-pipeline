import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  compatibilityPlan,
  migrationInventory,
  validateCompatibility,
} from './schema-compatibility.mjs';

const old = { id: '0059_old', checksum: 'a'.repeat(64) };
const boundary = { id: '0060_boundary', checksum: 'b'.repeat(64) };
const future = { id: '0061_future', checksum: 'c'.repeat(64) };
const previous = { migrations: [old], metadata: null };
const requested = (compatibility = 'incompatible') => ({
  migrations: [old, boundary],
  metadata: {
    formatVersion: 1,
    migrations: { [old.id]: 'legacy-unclassified', [boundary.id]: compatibility },
  },
});

test('compatible migration preserves online deploy and previous-image rollback', () => {
  const plan = compatibilityPlan(requested('compatible'), [old], previous);
  assert.deepEqual(plan.pending, [boundary.id]);
  assert.equal(plan.quiesce, false);
  assert.equal(plan.imageRollbackSafe, true);
});

test('incompatible migration and retry after its commit block old-image recovery', () => {
  for (const applied of [[old], [old, boundary]]) {
    const plan = compatibilityPlan(requested(), applied, previous);
    assert.equal(plan.quiesce, true);
    assert.equal(plan.imageRollbackSafe, false);
    assert.deepEqual(plan.rollbackBlockers, [boundary.id]);
  }
});

test('already applied boundary supported by previous runtime does not require downtime', () => {
  const target = requested();
  target.migrations.push(future);
  target.metadata.migrations[future.id] = 'compatible';
  const plan = compatibilityPlan(target, [old, boundary], { migrations: [old, boundary] });
  assert.equal(plan.quiesce, false);
  assert.equal(plan.imageRollbackSafe, true);
});

test('pending unclassified history requires quiescence and blocks previous-image recovery', () => {
  const plan = compatibilityPlan(requested(), [], null);
  assert.deepEqual(plan.boundaries, [old.id, boundary.id]);
  assert.equal(plan.quiesce, true);
  assert.equal(plan.imageRollbackSafe, false);
});

test('missing, malformed, stale, and unclassified future declarations fail closed', () => {
  for (const metadata of [
    null,
    {},
    { formatVersion: 2, migrations: {} },
    { formatVersion: 1, migrations: {} },
    { formatVersion: 1, migrations: { [old.id]: 'compatible', [boundary.id]: 'maybe' } },
    {
      formatVersion: 1,
      migrations: { [old.id]: 'compatible', [boundary.id]: 'legacy-unclassified' },
    },
    {
      formatVersion: 1,
      migrations: { ...requested().metadata.migrations, [future.id]: 'compatible' },
    },
  ]) {
    assert.throws(() => validateCompatibility({ ...requested(), metadata }));
  }
});

test('database ahead of target, checksum drift, and ambiguous migration IDs fail closed', () => {
  assert.throws(() => compatibilityPlan(requested(), [old, future], previous));
  assert.throws(() =>
    compatibilityPlan(requested(), [{ ...old, checksum: 'f'.repeat(64) }], previous),
  );
  assert.throws(() => compatibilityPlan(requested(), [old, old], previous));
  assert.throws(() =>
    compatibilityPlan(requested(), [old], { migrations: [{ ...old, checksum: 'f'.repeat(64) }] }),
  );
  assert.throws(() =>
    validateCompatibility({ ...requested(), migrations: [old, { ...old, id: '0059_duplicate' }] }),
  );
});

test('production metadata retains 0060 as the known incompatible historical boundary', () => {
  const inventory = migrationInventory(
    fileURLToPath(new URL('../../packages/batch-backend/migrations', import.meta.url)),
  );
  const declarations = validateCompatibility(inventory);
  assert.equal(declarations['0060_user_settings_owner_key'], 'incompatible');
  const oldInventory = {
    migrations: inventory.migrations.filter((m) => !m.id.startsWith('0060_')),
  };
  const plan = compatibilityPlan(inventory, oldInventory.migrations, oldInventory);
  assert.deepEqual(plan.boundaries, ['0060_user_settings_owner_key']);
  assert.equal(plan.imageRollbackSafe, false);
});

test('0061 requires writer quiescence and blocks old-image recovery before and after commit', () => {
  const inventory = migrationInventory(
    fileURLToPath(new URL('../../packages/batch-backend/migrations', import.meta.url)),
  );
  const previous = { migrations: inventory.migrations.filter((m) => !m.id.startsWith('0061_')) };
  assert.equal(validateCompatibility(inventory)['0061_ordinary_memory_replay'], 'incompatible');
  for (const applied of [previous.migrations, inventory.migrations]) {
    const plan = compatibilityPlan(inventory, applied, previous);
    assert.equal(plan.quiesce, true);
    assert.equal(plan.imageRollbackSafe, false);
    assert.deepEqual(plan.rollbackBlockers, ['0061_ordinary_memory_replay']);
  }
});

test('invalid JSON is rejected by image inventory without application bootstrap', () => {
  const directory = mkdtempSync(join(tmpdir(), 'esl-compatibility-'));
  try {
    writeFileSync(join(directory, '0061_future.sql'), 'SELECT 1;');
    writeFileSync(join(directory, 'runtime-compatibility.json'), '{invalid');
    assert.throws(() => migrationInventory(directory), SyntaxError);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

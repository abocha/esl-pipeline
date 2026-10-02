import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const idPattern = /^\d{4}_[a-z0-9_]+$/;

// Also run via stdin in an isolated image container. No application boot or DB access.
export function migrationInventory(directory) {
  const migrations = readdirSync(directory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => ({
      id: name.slice(0, -4),
      checksum: createHash('sha256')
        .update(readFileSync(`${directory}/${name}`))
        .digest('hex'),
    }));
  let metadata = null;
  try {
    metadata = JSON.parse(readFileSync(`${directory}/runtime-compatibility.json`, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { migrations, metadata };
}

function inventoryMap(inventory) {
  if (!Array.isArray(inventory.migrations) || inventory.migrations.length === 0) {
    throw new Error('Missing migration inventory');
  }
  const result = new Map();
  const numbers = new Set();
  for (const { id, checksum } of inventory.migrations) {
    if (!idPattern.test(id) || !/^[a-f0-9]{64}$/.test(checksum) || numbers.has(id.slice(0, 4))) {
      throw new Error(`Invalid or duplicate migration: ${id}`);
    }
    numbers.add(id.slice(0, 4));
    result.set(id, checksum);
  }
  return result;
}

export function validateCompatibility(inventory) {
  const migrations = inventoryMap(inventory);
  const metadata = inventory.metadata;
  if (metadata?.formatVersion !== 1 || !metadata.migrations || Array.isArray(metadata.migrations)) {
    throw new Error('Missing or unsupported runtime compatibility metadata');
  }
  for (const id of new Set([...migrations.keys(), ...Object.keys(metadata.migrations)])) {
    const compatibility = metadata.migrations[id];
    if (
      !migrations.has(id) ||
      !['compatible', 'incompatible', 'legacy-unclassified'].includes(compatibility)
    ) {
      throw new Error(`Missing or invalid compatibility declaration: ${id}`);
    }
    if (compatibility === 'legacy-unclassified' && Number(id.slice(0, 4)) >= 60) {
      throw new Error(`Future migrations require explicit runtime compatibility: ${id}`);
    }
  }
  return metadata.migrations;
}

export function compatibilityPlan(requested, applied, previous) {
  const declarations = validateCompatibility(requested);
  const requestedMap = inventoryMap(requested);
  const previousMap = previous ? inventoryMap(previous) : new Map();
  if (!Array.isArray(applied)) throw new Error('Invalid applied migration ledger');
  const appliedIds = new Set();
  for (const { id, checksum } of applied) {
    if (appliedIds.has(id) || requestedMap.get(id) !== checksum) {
      throw new Error(`Applied migration missing or checksum mismatch in requested image: ${id}`);
    }
    appliedIds.add(id);
  }
  const pending = [...requestedMap.keys()].filter((id) => !appliedIds.has(id));
  const boundaries = pending.filter((id) => declarations[id] !== 'compatible');
  // The old runtime is known to support migrations packaged in its own image.
  // Any absent migration needs an explicit backwards-compatible declaration.
  const rollbackBlockers = [...requestedMap.keys()].filter((id) => {
    if (previousMap.has(id)) {
      if (previousMap.get(id) !== requestedMap.get(id))
        throw new Error(`Previous image checksum mismatch: ${id}`);
      return false;
    }
    return declarations[id] !== 'compatible';
  });
  return {
    pending,
    boundaries,
    quiesce: boundaries.length > 0 || rollbackBlockers.some((id) => appliedIds.has(id)),
    imageRollbackSafe: Boolean(previous) && rollbackBlockers.length === 0,
    rollbackBlockers,
  };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'inventory') {
    console.log(JSON.stringify(migrationInventory(args[0])));
  } else if (command === 'validate') {
    validateCompatibility(migrationInventory(args[0]));
  } else if (command === 'check-compose') {
    const config = JSON.parse(readFileSync(0, 'utf8'));
    for (const [service, settings] of Object.entries(config.services)) {
      const directory = settings.environment?.PG_MIGRATIONS_DIR;
      if (directory && directory !== '/app/migrations') {
        throw new Error(
          `Service ${service}: production deploy requires image-packaged migrations; PG_MIGRATIONS_DIR overrides are unsupported`,
        );
      }
    }
  } else if (command === 'plan') {
    const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
    const plan = compatibilityPlan(
      read(args[0]),
      read(args[1]),
      args[2] === '-' ? null : read(args[2]),
    );
    plan.deploymentSha = args[4];
    plan.requestedBackendImage = args[5];
    plan.previousBackendImage = args[6] || null;
    writeFileSync(args[3], `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o640 });
    console.log(
      `Schema compatibility: pending=${plan.pending.join(',') || 'none'} boundaries=${plan.boundaries.join(',') || 'none'} quiesce=${plan.quiesce} image_rollback_safe=${plan.imageRollbackSafe} rollback_blockers=${plan.rollbackBlockers.join(',') || 'none'}`,
    );
  } else {
    throw new Error('Expected inventory, validate, check-compose, or plan');
  }
}

if (process.argv[1] === '-' || process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Schema compatibility preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}

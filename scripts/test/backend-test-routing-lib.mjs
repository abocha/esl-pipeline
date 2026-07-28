import { readFileSync } from 'node:fs';
import path from 'node:path';

const serviceGroups = [
  'deterministicIntegration',
  'postgresMigrations',
  'postgres',
  'postgresRedisWorker',
];
const unitScripts = ['test:unit', 'test:unit:prebuilt', 'test:unit:timings'];
const serviceScripts = {
  deterministicIntegration: 'test:integration:http',
  postgresMigrations: 'test:db:migrations',
  postgres: 'test:db:postgres',
  postgresRedisWorker: 'test:integration:worker',
};
const serviceSignals = [
  'support/bootstrap-pg-test-env',
  'requirePgTestEnv',
  'requireRedisTestEnv',
  'BATCH_BACKEND_TEST_PG',
  'BATCH_BACKEND_TEST_REDIS',
];
const unitSignalExemptions = new Set(['bootstrap.pg-test-env.test.ts', 'support/test-env.test.ts']);

export function readBackendTestRouting(repoRoot) {
  const manifestPath = path.join(
    repoRoot,
    'packages',
    'batch-backend',
    'tests',
    'test-routing.json',
  );
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

export function classifyBackendTests({ testFiles, routing }) {
  const normalizedFiles = [...new Set(testFiles.map(normalizeTestFile))].sort();
  const deterministicIntegration = normalizedFiles.filter((file) =>
    routing.deterministicIntegration.prefixes.some((prefix) => file.startsWith(prefix)),
  );
  const classifications = {
    deterministicIntegration,
    postgresMigrations: normalizeEntries(routing.postgresMigrations),
    postgres: normalizeEntries(routing.postgres),
    postgresRedisWorker: normalizeEntries(routing.postgresRedisWorker),
  };
  const serviceFiles = new Set(serviceGroups.flatMap((group) => classifications[group]));

  return {
    unit: normalizedFiles.filter((file) => !serviceFiles.has(file)),
    ...classifications,
  };
}

export function validateBackendTestRouting({ classifications, backendScripts, sourceImports }) {
  const violations = [];
  const sourceByFile = normalizeSourceImports(sourceImports);
  const owners = new Map();

  for (const group of serviceGroups) {
    for (const file of classifications[group] ?? []) {
      const fileOwners = owners.get(file) ?? [];
      fileOwners.push(group);
      owners.set(file, fileOwners);

      if (!sourceByFile.has(file)) {
        violations.push(`${file} is listed in ${group} but does not exist.`);
      }
    }
  }

  for (const [file, fileOwners] of owners) {
    if (fileOwners.length > 1) {
      violations.push(`${file} appears in multiple service groups: ${fileOwners.join(', ')}.`);
    }
  }

  for (const group of serviceGroups) {
    const scriptName = serviceScripts[group];
    const script = backendScripts[scriptName];
    if (typeof script !== 'string') {
      violations.push(`${scriptName} is required for ${group} tests.`);
      continue;
    }
    for (const file of classifications[group] ?? []) {
      if (sourceByFile.has(file) && !scriptSelectsFile(script, file)) {
        violations.push(`${file} is not selected by ${scriptName}.`);
      }
    }
  }

  for (const scriptName of unitScripts) {
    const script = backendScripts[scriptName];
    if (typeof script !== 'string') {
      violations.push(`${scriptName} is required for unit routing.`);
      continue;
    }
    const excludes = parseExcludes(script);
    for (const file of owners.keys()) {
      if (sourceByFile.has(file) && !excludes.some((pattern) => globMatches(pattern, file))) {
        violations.push(`${file} is not excluded from ${scriptName}.`);
      }
    }
  }

  for (const file of classifications.unit ?? []) {
    if (unitSignalExemptions.has(file)) {
      continue;
    }
    const source = sourceByFile.get(file) ?? '';
    for (const signal of serviceSignals) {
      if (source.includes(signal)) {
        violations.push(`${file} is classified as unit but imports service signal ${signal}.`);
      }
    }
  }

  return violations;
}

function normalizeEntries(entries) {
  return [...new Set((entries ?? []).map(normalizeTestFile))].sort();
}

function normalizeTestFile(file) {
  return String(file).replaceAll('\\', '/').split('/').at(-1);
}

function normalizeSourceImports(sourceImports) {
  const entries =
    sourceImports instanceof Map ? sourceImports.entries() : Object.entries(sourceImports);
  return new Map([...entries].map(([file, source]) => [normalizeTestFile(file), String(source)]));
}

function scriptSelectsFile(script, file) {
  if (script.includes(file)) {
    return true;
  }
  return tokenize(script)
    .filter((token) => !token.startsWith('-'))
    .map(normalizeSelector)
    .some((selector) => selector.endsWith('.') && file.startsWith(selector));
}

function parseExcludes(script) {
  const tokens = tokenize(script);
  const excludes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--exclude' && tokens[index + 1]) {
      excludes.push(tokens[index + 1]);
      index += 1;
    } else if (token.startsWith('--exclude=')) {
      excludes.push(token.slice('--exclude='.length));
    }
  }
  return excludes;
}

function tokenize(value) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? null : quote || char;
      continue;
    }
    if (!quote && /\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function normalizeSelector(selector) {
  return selector.replaceAll('\\', '/').split('/').at(-1);
}

function globMatches(pattern, file) {
  const normalizedPattern = normalizeSelector(pattern);
  const expression = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replaceAll('**', '.*')
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '.');
  return new RegExp(`^${expression}$`, 'u').test(file);
}
